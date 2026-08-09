/**
 * Leverandører — port av v1s `routers/vendors.py`.
 *
 * ## Ikke portert ennå
 *
 * - Portalbruker (`PUT/DELETE /{id}/portal-user`) — leverandørportalen er en egen
 *   innloggingsvei med sitt eget tilgangsoppsett, og hører til en senere fase.
 * - Unloc-nøkler (`vendor_unloc_keys`) — integrasjonen har egne credentials per kunde og
 *   krypterte hemmeligheter; egen runde.
 */

import { and, asc, count, desc, eq, ne } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "../db/client";
import { contracts } from "../db/schema/kontrakter";
import { tasks } from "../db/schema/tasks";
import {
  vendorAccessItems,
  vendorContacts,
  vendorNotes,
  vendors,
} from "../db/schema/vendors";
import { ikkeFunnet, ugyldig } from "./api";

export const RELASJONSTYPER = ["avtale", "handelskonto", "adhoc"] as const;
export const ADGANGSSTATUSER = ["utlevert", "bør_sjekkes", "innlevert"] as const;

const tekst = z.string().trim().nullish();

export const leverandorInn = z.object({
  name: z.string().trim().min(1, "Navn må fylles ut"),
  relationshipType: z.enum(RELASJONSTYPER).default("avtale"),
  category: tekst,
  customerNumber: tekst,
  ehf: z.boolean().default(false),
  lastUsedAt: z.string().date().nullish(),
  notes: z.string().nullish(),
  orgNumber: tekst,
  invoiceReference: tekst,
  active: z.boolean().default(true),
});

export const leverandorEndring = leverandorInn.partial();

export const kontaktInn = z.object({
  name: z.string().trim().min(1, "Navn må fylles ut"),
  role: tekst,
  email: tekst,
  phone: tekst,
  isPrimary: z.boolean().default(false),
});

export const adgangInn = z.object({
  title: z.string().trim().min(1, "Tittel må fylles ut"),
  description: z.string().nullish(),
  areas: tekst,
  status: z.enum(ADGANGSSTATUSER).default("utlevert"),
  issuedTo: tekst,
  issuedAt: z.string().date().nullish(),
});

export const notatInn = z.object({
  text: z.string().trim().min(1, "Notatet kan ikke være tomt"),
});

// ---------------------------------------------------------------------------------------
// Leverandøren
// ---------------------------------------------------------------------------------------

export async function hentLeverandorer(db: Db, orgId: string, opts: { aktive?: boolean } = {}) {
  const betingelser = [eq(vendors.orgId, orgId)];
  if (opts.aktive !== undefined) betingelser.push(eq(vendors.active, opts.aktive));
  return db
    .select()
    .from(vendors)
    .where(and(...betingelser))
    .orderBy(asc(vendors.name));
}

export async function hentLeverandor(db: Db, orgId: string, vendorId: string) {
  const rader = await db
    .select()
    .from(vendors)
    .where(and(eq(vendors.id, vendorId), eq(vendors.orgId, orgId)))
    .limit(1);
  const lev = rader[0];
  if (!lev) throw ikkeFunnet("Leverandør");

  const [kontakter, adgang, notater] = await Promise.all([
    db
      .select()
      .from(vendorContacts)
      .where(eq(vendorContacts.vendorId, vendorId))
      .orderBy(desc(vendorContacts.isPrimary), asc(vendorContacts.createdAt)),
    db
      .select()
      .from(vendorAccessItems)
      .where(eq(vendorAccessItems.vendorId, vendorId))
      .orderBy(asc(vendorAccessItems.title)),
    db
      .select()
      .from(vendorNotes)
      .where(eq(vendorNotes.vendorId, vendorId))
      .orderBy(desc(vendorNotes.createdAt)),
  ]);

  return { ...lev, kontakter, adgang, notater };
}

export async function opprettLeverandor(db: Db, orgId: string, data: z.infer<typeof leverandorInn>) {
  const [ny] = await db
    .insert(vendors)
    .values({ id: randomUUID(), orgId, ...data })
    .returning();
  return ny!;
}

export async function endreLeverandor(
  db: Db,
  orgId: string,
  vendorId: string,
  data: z.infer<typeof leverandorEndring>,
) {
  await hentLeverandor(db, orgId, vendorId);
  const [endret] = await db
    .update(vendors)
    .set(data)
    .where(and(eq(vendors.id, vendorId), eq(vendors.orgId, orgId)))
    .returning();
  return endret!;
}

/**
 * Sletter leverandøren — men bare hvis ingenting peker på den.
 *
 * Oppgaver og kontrakter blokkerer. Alternativet ville vært kaskade, og da forsvinner en
 * serviceavtale med hele sin prishistorikk fordi noen ryddet i leverandørlista. Meldingen
 * sier hva som må gjøres først, ikke bare at det ikke går.
 *
 * **Merk avviket fra v1.** v1 telte bare AKTIVE oppgaver her, men `tasks.vendor_id` er en
 * fremmednøkkel uten ON DELETE, så en deaktivert oppgave stoppet slettingen likevel — med
 * en 500 fra databasen i stedet for en forklaring. Her telles alle oppgaver, slik at svaret
 * er det samme som utfallet.
 */
export async function slettLeverandor(db: Db, orgId: string, vendorId: string) {
  await hentLeverandor(db, orgId, vendorId);

  const [oppgaver] = await db
    .select({ antall: count() })
    .from(tasks)
    .where(and(eq(tasks.vendorId, vendorId), eq(tasks.orgId, orgId)));
  if ((oppgaver?.antall ?? 0) > 0) {
    const n = oppgaver!.antall;
    throw ugyldig(
      `Leverandøren har ${n} oppgave${n !== 1 ? "r" : ""} (inkludert deaktiverte) — ` +
        "flytt eller slett disse først",
    );
  }

  const [avtaler] = await db
    .select({ antall: count() })
    .from(contracts)
    .where(and(eq(contracts.vendorId, vendorId), eq(contracts.orgId, orgId)));
  if ((avtaler?.antall ?? 0) > 0) {
    const n = avtaler!.antall;
    throw ugyldig(`Leverandøren har ${n} kontrakt${n !== 1 ? "er" : ""} — slett disse først`);
  }

  // Kontakter, adgangselementer og notater kaskaderer med leverandøren — de har ingen verdi
  // uten den, i motsetning til oppgaver og kontrakter.
  await db.delete(vendors).where(and(eq(vendors.id, vendorId), eq(vendors.orgId, orgId)));
}

// ---------------------------------------------------------------------------------------
// Kontaktpersoner
// ---------------------------------------------------------------------------------------

/** Én primærkontakt per leverandør. Settes en ny, mister de andre merket. */
async function fjernAndrePrimaere(db: Db, vendorId: string, utenom?: string) {
  const betingelser = [eq(vendorContacts.vendorId, vendorId), eq(vendorContacts.isPrimary, true)];
  if (utenom) betingelser.push(ne(vendorContacts.id, utenom));
  await db.update(vendorContacts).set({ isPrimary: false }).where(and(...betingelser));
}

export async function leggTilKontakt(
  db: Db,
  orgId: string,
  vendorId: string,
  data: z.infer<typeof kontaktInn>,
) {
  await hentLeverandor(db, orgId, vendorId);
  const id = randomUUID();
  if (data.isPrimary) await fjernAndrePrimaere(db, vendorId);

  const [ny] = await db
    .insert(vendorContacts)
    .values({ id, orgId, vendorId, ...data })
    .returning();
  return ny!;
}

export async function endreKontakt(
  db: Db,
  orgId: string,
  vendorId: string,
  kontaktId: string,
  data: Partial<z.infer<typeof kontaktInn>>,
) {
  await hentLeverandor(db, orgId, vendorId);
  const finnes = await db
    .select({ id: vendorContacts.id })
    .from(vendorContacts)
    .where(and(eq(vendorContacts.id, kontaktId), eq(vendorContacts.vendorId, vendorId)))
    .limit(1);
  if (finnes.length === 0) throw ikkeFunnet("Kontaktperson");

  if (data.isPrimary) await fjernAndrePrimaere(db, vendorId, kontaktId);

  const [endret] = await db
    .update(vendorContacts)
    .set(data)
    .where(and(eq(vendorContacts.id, kontaktId), eq(vendorContacts.vendorId, vendorId)))
    .returning();
  return endret!;
}

export async function slettKontakt(db: Db, orgId: string, vendorId: string, kontaktId: string) {
  await hentLeverandor(db, orgId, vendorId);
  const slettet = await db
    .delete(vendorContacts)
    .where(and(eq(vendorContacts.id, kontaktId), eq(vendorContacts.vendorId, vendorId)))
    .returning({ id: vendorContacts.id });
  if (slettet.length === 0) throw ikkeFunnet("Kontaktperson");
}

// ---------------------------------------------------------------------------------------
// Adgangskontroll
// ---------------------------------------------------------------------------------------

export async function leggTilAdgang(
  db: Db,
  orgId: string,
  vendorId: string,
  data: z.infer<typeof adgangInn>,
) {
  await hentLeverandor(db, orgId, vendorId);
  const [ny] = await db
    .insert(vendorAccessItems)
    .values({ id: randomUUID(), orgId, vendorId, ...data })
    .returning();
  return ny!;
}

export async function endreAdgang(
  db: Db,
  orgId: string,
  vendorId: string,
  itemId: string,
  data: Partial<z.infer<typeof adgangInn>>,
) {
  await hentLeverandor(db, orgId, vendorId);
  const [endret] = await db
    .update(vendorAccessItems)
    .set(data)
    .where(and(eq(vendorAccessItems.id, itemId), eq(vendorAccessItems.vendorId, vendorId)))
    .returning();
  if (!endret) throw ikkeFunnet("Adgangselement");
  return endret;
}

export async function slettAdgang(db: Db, orgId: string, vendorId: string, itemId: string) {
  await hentLeverandor(db, orgId, vendorId);
  const slettet = await db
    .delete(vendorAccessItems)
    .where(and(eq(vendorAccessItems.id, itemId), eq(vendorAccessItems.vendorId, vendorId)))
    .returning({ id: vendorAccessItems.id });
  if (slettet.length === 0) throw ikkeFunnet("Adgangselement");
}

// ---------------------------------------------------------------------------------------
// Notater
// ---------------------------------------------------------------------------------------

/** Notater er append-only, som behandlingsjournalen på avvik. Ingen endre-funksjon. */
export async function leggTilNotat(
  db: Db,
  orgId: string,
  vendorId: string,
  forfatter: string,
  data: z.infer<typeof notatInn>,
) {
  await hentLeverandor(db, orgId, vendorId);
  const [ny] = await db
    .insert(vendorNotes)
    .values({ id: randomUUID(), orgId, vendorId, text: data.text, authorName: forfatter })
    .returning();
  return ny!;
}

export async function slettNotat(db: Db, orgId: string, vendorId: string, notatId: string) {
  await hentLeverandor(db, orgId, vendorId);
  const slettet = await db
    .delete(vendorNotes)
    .where(and(eq(vendorNotes.id, notatId), eq(vendorNotes.vendorId, vendorId)))
    .returning({ id: vendorNotes.id });
  if (slettet.length === 0) throw ikkeFunnet("Notat");
}
