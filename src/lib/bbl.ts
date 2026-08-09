/**
 * Register over boligbyggelag (BL-85). Port av v1s `routers/bbl.py`.
 *
 * Registeret er globalt: flere kunder kan være tilknyttet samme lag, og lagene føres
 * uavhengig av om noen kunde bruker dem. Derfor `withoutRls("plattformpanelet")` på
 * rutene, som i panelet for øvrig — det finnes ingen én org-kontekst her.
 *
 * Kunder leser aldri herfra. De ser navnet på sitt eget lag gjennom organisasjonsraden sin.
 */

import { and, asc, count, eq, isNotNull, ne, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "../db/client";
import { bbl } from "../db/schema/bbl";
import { organizations } from "../db/schema/organizations";
import { ikkeFunnet, ugyldig } from "./api";
import { normaliserOrgnr } from "./orgnr";

export const bblInn = z.object({
  name: z.string().trim().min(1, "Navn må fylles ut"),
  orgNr: z.string().trim().nullish(),
  region: z.string().trim().nullish(),
  website: z.string().trim().nullish(),
  notes: z.string().nullish(),
  active: z.boolean().default(true),
});

export const bblEndring = bblInn.partial();

export const fusjonInn = z.object({
  successorId: z.string().min(1, "Velg hvilket lag det fusjoneres inn i"),
  mergeDate: z.string().nullish(),
});

/**
 * Kundetall per lag og id→navn, i to spørringer i stedet for én per rad.
 *
 * Tellingen dekker BÅDE tilknytning og forretningsførsel: et lag som er forretningsfører for
 * tre borettslag uten å ha dem tilknyttet, er ikke «ikke i bruk». Den teller UNIKE
 * organisasjoner — det vanligste tilfellet er at kunden både er tilknyttet laget og har det
 * som forretningsfører, og da er de fortsatt én kunde, ikke to.
 */
async function oppslag(db: Db) {
  const rader = await db
    .select({
      orgId: organizations.id,
      bblId: organizations.bblId,
      managerBblId: organizations.managerBblId,
    })
    .from(organizations)
    .where(or(isNotNull(organizations.bblId), isNotNull(organizations.managerBblId)));

  const kunder = new Map<string, Set<string>>();
  for (const r of rader) {
    for (const felt of [r.bblId, r.managerBblId]) {
      if (!felt) continue;
      if (!kunder.has(felt)) kunder.set(felt, new Set());
      kunder.get(felt)!.add(r.orgId);
    }
  }

  const navn = new Map(
    (await db.select({ id: bbl.id, name: bbl.name }).from(bbl)).map((b) => [b.id, b.name]),
  );
  return { antall: kunder, navn };
}

type Rad = typeof bbl.$inferSelect;

function ut(rad: Rad, o: Awaited<ReturnType<typeof oppslag>>) {
  return {
    ...rad,
    antallKunder: o.antall.get(rad.id)?.size ?? 0,
    successorName: rad.successorId ? (o.navn.get(rad.successorId) ?? null) : null,
  };
}

export type BblUt = ReturnType<typeof ut>;

export async function hentAlle(db: Db): Promise<BblUt[]> {
  const o = await oppslag(db);
  const rader = await db.select().from(bbl).orderBy(asc(bbl.name));
  return rader.map((r) => ut(r, o));
}

async function hentEn(db: Db, bblId: string): Promise<Rad> {
  const rader = await db.select().from(bbl).where(eq(bbl.id, bblId)).limit(1);
  const rad = rader[0];
  if (!rad) throw ikkeFunnet("Boligbyggelaget");
  return rad;
}

/** Org.nr må være ledig. Egen sjekk foran unikhetsindeksen, så feilmeldingen blir lesbar. */
async function krevLedigOrgnr(db: Db, orgNr: string, utenom?: string) {
  const betingelser = [eq(bbl.orgNr, orgNr)];
  if (utenom) betingelser.push(ne(bbl.id, utenom));
  const finnes = await db
    .select({ id: bbl.id })
    .from(bbl)
    .where(and(...betingelser))
    .limit(1);
  if (finnes.length > 0) throw ugyldig("Organisasjonsnummeret er allerede registrert");
}

export async function opprett(db: Db, data: z.infer<typeof bblInn>): Promise<BblUt> {
  const orgNr = normaliserOrgnr(data.orgNr);
  if (orgNr) await krevLedigOrgnr(db, orgNr);

  const [ny] = await db
    .insert(bbl)
    .values({
      id: randomUUID(),
      name: data.name,
      orgNr,
      region: data.region ?? null,
      website: data.website ?? null,
      notes: data.notes ?? null,
      active: data.active,
    })
    .returning();
  return ut(ny!, await oppslag(db));
}

export async function endre(
  db: Db,
  bblId: string,
  data: z.infer<typeof bblEndring>,
): Promise<BblUt> {
  await hentEn(db, bblId);

  const felter: Partial<Rad> = {};
  if (data.name !== undefined) felter.name = data.name;
  if (data.region !== undefined) felter.region = data.region ?? null;
  if (data.website !== undefined) felter.website = data.website ?? null;
  if (data.notes !== undefined) felter.notes = data.notes ?? null;
  if (data.active !== undefined) felter.active = data.active;
  if (data.orgNr !== undefined) {
    const orgNr = normaliserOrgnr(data.orgNr);
    if (orgNr) await krevLedigOrgnr(db, orgNr, bblId);
    felter.orgNr = orgNr;
  }

  // Drizzle kaster på `.set({})`.
  if (Object.keys(felter).length > 0) {
    await db.update(bbl).set(felter).where(eq(bbl.id, bblId));
  }
  return ut(await hentEn(db, bblId), await oppslag(db));
}

/**
 * Varsler at laget går inn i et annet på en gitt dato.
 *
 * Dette VARSLER bare. Kundene flyttes ikke her — det skjer i `gjennomforFusjon`, som
 * plattformadmin utløser manuelt. Med dagens kundetall er en bakgrunnsjobb som flytter
 * borettslag mellom boligbyggelag på egen hånd mer risiko enn nytte; en fusjon er en
 * hendelse noen uansett følger opp, og styrene skal varsles av et menneske.
 */
export async function varsleFusjon(
  db: Db,
  bblId: string,
  data: z.infer<typeof fusjonInn>,
): Promise<BblUt> {
  await hentEn(db, bblId);
  if (data.successorId === bblId) {
    throw ugyldig("Et boligbyggelag kan ikke fusjoneres med seg selv");
  }
  const etterfolger = await db
    .select({ id: bbl.id, successorId: bbl.successorId })
    .from(bbl)
    .where(eq(bbl.id, data.successorId))
    .limit(1);
  if (!etterfolger[0]) throw ikkeFunnet("Etterfølgeren");
  // Uten dette kan A → B og B → A settes opp, og enhver oppfølging av kjeden går i ring.
  if (etterfolger[0].successorId === bblId) {
    throw ugyldig("Etterfølgeren peker allerede tilbake på dette laget");
  }

  await db
    .update(bbl)
    .set({ successorId: data.successorId, mergeDate: data.mergeDate ?? null })
    .where(eq(bbl.id, bblId));
  return ut(await hentEn(db, bblId), await oppslag(db));
}

export async function avlysFusjon(db: Db, bblId: string): Promise<BblUt> {
  await hentEn(db, bblId);
  await db.update(bbl).set({ successorId: null, mergeDate: null }).where(eq(bbl.id, bblId));
  return ut(await hentEn(db, bblId), await oppslag(db));
}

/**
 * Flytter alle kunder over til etterfølgeren og markerer laget som utgått.
 *
 * Den gamle raden BLIR STÅENDE med `successorId` intakt. Sletting ville tømt `bblId` på
 * kundene som var tilknyttet, og da kan ikke en årsberetning fra 2026 lenger si hvem laget
 * var tilknyttet den gang.
 */
export async function gjennomforFusjon(db: Db, bblId: string): Promise<BblUt> {
  const rad = await hentEn(db, bblId);
  if (!rad.successorId) throw ugyldig("Ingen fusjon er varslet for dette laget");

  await db
    .update(organizations)
    .set({ bblId: rad.successorId })
    .where(eq(organizations.bblId, bblId));
  await db
    .update(organizations)
    .set({ managerBblId: rad.successorId })
    .where(eq(organizations.managerBblId, bblId));

  await db
    .update(bbl)
    .set({
      active: false,
      // Gjennomføres fusjonen uten at en dato ble varslet, er datoen i dag.
      mergeDate: rad.mergeDate ?? sql`current_date`,
    })
    .where(eq(bbl.id, bblId));

  return ut(await hentEn(db, bblId), await oppslag(db));
}

/**
 * Kun for lag som er FEILREGISTRERT.
 *
 * Er en kunde koblet til laget, må fusjon brukes i stedet — da bevares historikken. Det
 * samme gjelder hvis et annet lag peker hit som etterfølger: sletting ville brutt kjeden.
 */
export async function slett(db: Db, bblId: string): Promise<void> {
  await hentEn(db, bblId);

  const iBruk = await db
    .select({ n: count() })
    .from(organizations)
    .where(or(eq(organizations.bblId, bblId), eq(organizations.managerBblId, bblId)));
  const antall = iBruk[0]?.n ?? 0;
  if (antall > 0) {
    throw ugyldig(
      `${antall} kunde${antall === 1 ? "" : "r"} er koblet til dette laget. Registrer en fusjon i stedet for å slette.`,
    );
  }

  const pekere = await db.select({ n: count() }).from(bbl).where(eq(bbl.successorId, bblId));
  if ((pekere[0]?.n ?? 0) > 0) {
    throw ugyldig("Et annet boligbyggelag peker på dette som etterfølger");
  }

  await db.delete(bbl).where(eq(bbl.id, bblId));
}
