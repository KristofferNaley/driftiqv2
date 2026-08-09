/**
 * Filopplasting og lagringskvote. Port av v1s `storage.py` + `paths.py`.
 *
 * ## Kvoten kan ikke telle noe annet enn den håndhever
 *
 * v1 hadde en advarsel øverst i `storage.py`: «`org_storage_used` må telle nøyaktig de samme
 * kildene som håndheves. Teller vi færre enn vi blokkerer, stoppes kunden på et tall de ikke
 * ser; teller vi flere, ser de en bruk de ikke kan påvirke.» Den regelen var prosa, og lista
 * over seks modeller måtte holdes i synk for hånd av fem ulike routere.
 *
 * Her er `FILTABELLER` det ENE registeret. Både summeringen og håndhevingen leser det, og
 * testen `alle filtabeller er med i kvoten` feiler hvis noen legger til en tabell med
 * `file_size` uten å føre den opp — samme mønster som RLS-dekningstesten, og av samme grunn:
 * det er tabellen noen legger til om fjorten måneder som er faren.
 *
 * ## Katalogstruktur
 *
 * `uploads/orgs/{orgId}/<modul>/…` — org først, modul etterpå, så ALT en kunde eier ligger
 * under én mappe. Sletting ved oppsigelse og innsyn ved forespørsel blir én sti.
 *
 * v1 måtte i tillegg bære en `finn_fil()`-fallback og en `migrate_uploads()` ved hver
 * oppstart, fordi den gamle strukturen var modul-først. v2 starter i den nye strukturen og
 * trenger ingen av delene.
 */

import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { organizations } from "../db/schema/organizations";
import { ApiFeil, ugyldig } from "./api";

export const UPLOAD_DIR = process.env.UPLOAD_DIR ?? "/app/uploads";

/** Standard for kunder uten egen kvote (`organizations.storageQuota = NULL`). */
export const STANDARD_KVOTE = 5 * 1024 * 1024 * 1024; // 5 GB

/** Maks per fil. Kvoten er taket for org-en; dette er taket for én opplasting. */
export const MAKS_FILSTORRELSE = 15 * 1024 * 1024; // 15 MB

/**
 * Tillatte filtyper, med filendelsen de lagres med.
 *
 * Endelsen kommer fra DENNE tabellen, aldri fra filnavnet brukeren sendte. Et opplastet
 * «rapport.pdf.exe» blir lagret som `<uuid>.pdf` — originalnavnet beholdes kun som
 * visningsnavn i databasen, og treffer aldri filsystemet.
 */
export const TILLATTE_TYPER: Readonly<Record<string, string>> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "application/pdf": ".pdf",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
};

/**
 * Tabellene som teller mot kvoten. Hver må ha `org_id` og `file_size`.
 *
 * Legger du til en modul som lagrer filer, skal tabellen inn her. Glemmer du det, feiler
 * `lagring.test.ts` — ikke i produksjon, der symptomet ville vært en kunde som fyller disken
 * uten at framdriftslinja beveger seg.
 */
export const FILTABELLER: readonly string[] = [
  "contracts",
  "documents",
  "element_documents",
  "unit_work_documents",
  // Fylles etter hvert som modulene portes: `documents`, `deviation_attachments`,
  // `completion_photos`, `element_documents` og `unit_work_documents`.
];

// ---------------------------------------------------------------------------------------
// Kvote
// ---------------------------------------------------------------------------------------

export function formatterStorrelse(n: number): string {
  // Tre trinn, ikke to. v1 lærte at fast GB-formatering ga «0,0 av 0,0 GB» for små kvoter —
  // en feilmelding uten informasjon. MB alene har samme problem ett nivå ned: 7 kB ble
  // «0 MB», og kunden kunne ikke se forskjell på «litt brukt» og «ingenting».
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} kB`;
  if (n < 1024 * 1024 * 1024) return `${Math.round(n / 1024 / 1024)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1).replace(".", ",")} GB`;
}

/** Samlet lagringsbruk på tvers av alle moduler som lagrer filer for org-en. */
export async function bruktLagring(db: Db, orgId: string): Promise<number> {
  if (FILTABELLER.length === 0) return 0;

  let sum = 0;
  for (const tabell of FILTABELLER) {
    // Tabellnavnene er hardkodet i registeret over, men settes inn i SQL som ikke kan
    // parameteriseres — samme resonnement som `sikkertNavn()` i rls/tables.ts.
    if (!/^[a-z_][a-z0-9_]*$/.test(tabell)) {
      throw new Error(`Ugyldig tabellnavn i FILTABELLER: ${tabell}`);
    }
    // Tabellnavnet via `sql.identifier` (siteres av Drizzle), org-id-en som bunden
    // parameter. Ingen strenginterpolering inn i SQL.
    const rader = await db.execute<{ sum: string | null }>(
      sql`SELECT COALESCE(SUM(file_size), 0)::bigint AS sum
          FROM ${sql.identifier(tabell)} WHERE org_id = ${orgId}`,
    );
    sum += Number(rader.rows[0]?.sum ?? 0);
  }
  return sum;
}

/** NULL på org-en betyr «ingen egen kvote» ⇒ bruk standarden. */
export async function orgKvote(db: Db, orgId: string): Promise<number> {
  const rader = await db
    .select({ kvote: organizations.storageQuota })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  const kvote = rader[0]?.kvote;
  return kvote ? Number(kvote) : STANDARD_KVOTE;
}

/** Kalles FØR fila skrives til disk. Kaster 413 hvis den ikke får plass. */
export async function krevLagringsplass(db: Db, orgId: string, innkommende: number): Promise<void> {
  if (innkommende <= 0) return;
  const [kvote, brukt] = await Promise.all([orgKvote(db, orgId), bruktLagring(db, orgId)]);
  if (brukt + innkommende > kvote) {
    throw new ApiFeil(
      413,
      `Lagringsplassen er brukt opp (${formatterStorrelse(brukt)} av ${formatterStorrelse(kvote)} ` +
        "brukt). Slett filer dere ikke trenger, eller ta kontakt med DriftIQ for mer plass.",
    );
  }
}

export async function lagringsstatus(db: Db, orgId: string) {
  const [kvote, brukt] = await Promise.all([orgKvote(db, orgId), bruktLagring(db, orgId)]);
  return { brukt, kvote, prosent: kvote > 0 ? Math.round((brukt / kvote) * 100) : 0 };
}

// ---------------------------------------------------------------------------------------
// Stier og skriving
// ---------------------------------------------------------------------------------------

/** Sti inn i org-treet: `orgSti(orgId, "deviations", devId)`. */
export function orgSti(orgId: string, ...deler: string[]): string {
  for (const del of [orgId, ...deler]) {
    // Ingen av disse kommer fra brukeren i dag, men en `..` her ville skrevet utenfor
    // uploads-treet. Billigere å nekte enn å stole på at det forblir slik.
    if (del.includes("/") || del.includes("\\") || del.includes("..")) {
      throw new Error(`Ugyldig stikomponent: ${JSON.stringify(del)}`);
    }
  }
  return path.join(UPLOAD_DIR, "orgs", orgId, ...deler);
}

export type Opplasting = {
  /** Lagret filnavn på disk — uuid-basert, aldri brukerens. */
  filnavn: string;
  /** Brukerens navn, kun til visning. Treffer aldri filsystemet. */
  originalnavn: string;
  contentType: string;
  storrelse: number;
  sti: string;
};

/**
 * Validerer og skriver en opplastet fil.
 *
 * Rekkefølgen er ikke valgfri: type og størrelse sjekkes FØR kvoten, og kvoten FØR disken.
 * En avvist fil skal aldri ha vært innom filsystemet.
 */
export type Opplastingsregler = {
  /** Undersett av `TILLATTE_TYPER`. Utelatt = alle tillatte typer. */
  typer?: readonly string[];
  maksStorrelse?: number;
  /**
   * Størrelsen på fila som ERSTATTES, om noen. Bare differansen teller mot kvoten — ellers
   * ville det å bytte ut et vedlegg med et like stort blitt regnet som ny bruk, og en kunde
   * på taket kunne aldri oppdatert en fil.
   */
  erstatter?: number | null;
};

export async function lagreFil(
  db: Db,
  orgId: string,
  modul: string,
  fil: File,
  regler: Opplastingsregler = {},
): Promise<Opplasting> {
  const endelse = TILLATTE_TYPER[fil.type];
  const tillatt = regler.typer ? regler.typer.includes(fil.type) : Boolean(endelse);
  if (!endelse || !tillatt) {
    throw ugyldig(
      regler.typer
        ? `Filtypen støttes ikke her. Tillatt: ${regler.typer.map((t) => TILLATTE_TYPER[t] ?? t).join(", ")}.`
        : "Filtypen støttes ikke. Tillatt: bilder (JPG, PNG, GIF, WebP), PDF og Word-dokumenter.",
    );
  }
  const maks = regler.maksStorrelse ?? MAKS_FILSTORRELSE;
  if (fil.size > maks) {
    throw ugyldig(`Filen er for stor. Maks ${formatterStorrelse(maks)} per fil.`);
  }
  if (fil.size <= 0) throw ugyldig("Filen er tom.");

  await krevLagringsplass(db, orgId, fil.size - (regler.erstatter ?? 0));

  const filnavn = `${randomUUID()}${endelse}`;
  const mappe = orgSti(orgId, modul);
  await mkdir(mappe, { recursive: true });
  const sti = path.join(mappe, filnavn);
  await writeFile(sti, Buffer.from(await fil.arrayBuffer()));

  return {
    filnavn,
    originalnavn: fil.name.slice(0, 255),
    contentType: fil.type,
    storrelse: fil.size,
    sti,
  };
}

/**
 * Sletter en fil fra disk. Feiler ikke hvis den allerede er borte.
 *
 * Databaseraden er sannheten om hva som finnes; en fil som mangler på disk er et problem,
 * men ikke ett som skal hindre kunden i å rydde opp i sin egen liste.
 */
export async function slettFil(orgId: string, modul: string, filnavn: string): Promise<void> {
  if (filnavn.includes("/") || filnavn.includes("\\") || filnavn.includes("..")) {
    throw new Error(`Ugyldig filnavn: ${JSON.stringify(filnavn)}`);
  }
  try {
    await unlink(path.join(orgSti(orgId, modul), filnavn));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}

/** Sti til en lagret fil, for lesing. */
export function filSti(orgId: string, modul: string, filnavn: string): string {
  if (filnavn.includes("/") || filnavn.includes("\\") || filnavn.includes("..")) {
    throw new Error(`Ugyldig filnavn: ${JSON.stringify(filnavn)}`);
  }
  return path.join(orgSti(orgId, modul), filnavn);
}
