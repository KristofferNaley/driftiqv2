/**
 * Enhetsregister — fysiske enheter i bygget. Port av v1s `routers/units.py`.
 *
 * Skriving krever `redigering` (ikke `orgadmin`): registeret er driftsdata som brukes når
 * avvik knyttes til et sted, ikke kontooppsett.
 *
 * Enheter er IKKE en egen modul — den ligger som fane under Innstillinger. Rutene oppgir
 * derfor ingen `modul` til `orgRute()`.
 *
 * ## Ikke portert ennå
 *
 * v1 har to endepunkter til som ikke er med her, fordi de drar inn avhengigheter som ennå
 * ikke finnes i v2:
 *
 * - `POST /import` — bulk-import fra regneark, med sammenslåing mot eksisterende rader
 * - `GET /adressesok` — oppslag mot Kartverkets API
 *
 * `apneAvvik` er på plass siden Avvik ble portert — feltet sto bevisst tomt fram til da,
 * i stedet for å returnere 0. Et felt som mangler er synlig; et som alltid er null ser
 * riktig ut og er det ikke.
 */

import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "../db/client";
import { units } from "../db/schema/units";
import { ikkeFunnet, ugyldig } from "./api";
import { avvikPerEnhet } from "./avvik";

export const ENHETSTYPER = ["bolig", "fellesareal"] as const;

const tekst = z.string().trim().nullish();

export const enhetInn = z.object({
  type: z.enum(ENHETSTYPER).default("bolig"),
  navn: tekst,
  beskrivelse: z.string().nullish(),
  andelsnr: tekst,
  leilighetsnr: tekst,
  oppgang: tekst,
  etasje: tekst,
  /**
   * `numeric` leses og skrives som STRENG — presisjon skal ikke innom en JS-float.
   * Normaliseres her, i skjemaet, så hvert skrivested slipper å huske konverteringen.
   */
  arealM2: z
    .union([z.string(), z.number()])
    .nullish()
    .transform((v) => (v === null || v === undefined ? v : String(v)))
    // `.optional()` etter transformen: uten den blir nøkkelen PÅKREVD i utdatatypen selv om
    // verdien kan være undefined, og hvert kallsted må sende `arealM2: undefined`.
    .optional(),
});

export const enhetEndring = enhetInn.partial();

type Felter = z.infer<typeof enhetEndring>;

/**
 * To typer, to identiteter: boliger kjennes på nummer, fellesarealer på navn.
 * Validerer den KOMBINERTE tilstanden, så en delvis oppdatering ikke kan etterlate en
 * bolig uten noen identitet.
 */
function validerIdentitet(f: Felter): void {
  if (f.type === "fellesareal") {
    if (!f.navn) throw ugyldig("Fellesarealet må ha et navn.");
    return;
  }
  if (!f.andelsnr && !f.leilighetsnr && !f.oppgang) {
    throw ugyldig("Enheten må ha minst andelsnummer, leilighetsnummer eller oppgang.");
  }
}

async function andelsnrErTatt(
  db: Db,
  orgId: string,
  andelsnr: string,
  utenomId?: string,
): Promise<boolean> {
  const betingelser = [eq(units.orgId, orgId), eq(units.andelsnr, andelsnr)];
  if (utenomId) betingelser.push(ne(units.id, utenomId));
  const rader = await db
    .select({ id: units.id })
    .from(units)
    .where(and(...betingelser))
    .limit(1);
  return rader.length > 0;
}

export async function hentEnheter(db: Db, orgId: string, opts: { medArkiverte?: boolean } = {}) {
  const betingelser = [eq(units.orgId, orgId)];
  if (!opts.medArkiverte) betingelser.push(isNull(units.archivedAt));

  const [rader, avvik] = await Promise.all([
    db
      .select()
      .from(units)
      .where(and(...betingelser))
      .orderBy(asc(units.andelsnr), asc(units.oppgang), asc(units.leilighetsnr)),
    // Én spørring for hele org-en, ikke én per rad.
    avvikPerEnhet(db, orgId),
  ]);

  return rader.map((r) => ({
    ...r,
    apneAvvik: avvik.get(r.id)?.apne ?? 0,
    antallAvvik: avvik.get(r.id)?.totalt ?? 0,
  }));
}

export async function hentEnhet(db: Db, orgId: string, unitId: string) {
  const rader = await db
    .select()
    .from(units)
    .where(and(eq(units.id, unitId), eq(units.orgId, orgId)))
    .limit(1);
  const enhet = rader[0];
  if (!enhet) throw ikkeFunnet("Enhet");
  return enhet;
}

export async function opprettEnhet(db: Db, orgId: string, data: z.infer<typeof enhetInn>) {
  validerIdentitet(data);
  if (data.andelsnr && (await andelsnrErTatt(db, orgId, data.andelsnr))) {
    throw ugyldig(`Andelsnummer ${data.andelsnr} finnes allerede.`);
  }
  const [ny] = await db
    .insert(units)
    .values({ id: randomUUID(), orgId, ...data })
    .returning();
  return ny!;
}

export async function endreEnhet(
  db: Db,
  orgId: string,
  unitId: string,
  data: z.infer<typeof enhetEndring>,
) {
  const enhet = await hentEnhet(db, orgId, unitId);
  validerIdentitet({ ...enhet, ...data } as Felter);

  if (data.andelsnr && data.andelsnr !== enhet.andelsnr) {
    if (await andelsnrErTatt(db, orgId, data.andelsnr, unitId)) {
      throw ugyldig(`Andelsnummer ${data.andelsnr} finnes allerede.`);
    }
  }

  const [endret] = await db
    .update(units)
    .set(data)
    .where(and(eq(units.id, unitId), eq(units.orgId, orgId)))
    .returning();
  return endret!;
}

/** Arkiverer — sletter aldri. Se kommentaren på `units.archivedAt`. */
export async function arkiverEnhet(db: Db, orgId: string, unitId: string) {
  const enhet = await hentEnhet(db, orgId, unitId);
  if (enhet.archivedAt) return enhet; // allerede arkivert — ikke flytt tidspunktet

  const [arkivert] = await db
    .update(units)
    .set({ archivedAt: sql`now()` })
    .where(and(eq(units.id, unitId), eq(units.orgId, orgId)))
    .returning();
  return arkivert!;
}

export async function gjenopprettEnhet(db: Db, orgId: string, unitId: string) {
  await hentEnhet(db, orgId, unitId);
  const [gjenopprettet] = await db
    .update(units)
    .set({ archivedAt: null })
    .where(and(eq(units.id, unitId), eq(units.orgId, orgId)))
    .returning();
  return gjenopprettet!;
}
