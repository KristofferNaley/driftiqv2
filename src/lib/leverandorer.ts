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

import { and, asc, count, desc, eq, isNotNull, isNull, ne } from "drizzle-orm";
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
import { ApiFeil, ikkeFunnet, ugyldig } from "./api";
import type { Aktor } from "./aktor";
import { loggHendelse } from "./hendelser";

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

/**
 * Lista bærer det oversikten trenger for å være en OVERSIKT: primærkontakten (hvem ringer
 * man), antall aktive avtaler og åpne oppgaver per leverandør. Tellingene hentes samlet —
 * én grupperende spørring per kilde, ikke én spørring per leverandør.
 */
export async function hentLeverandorer(db: Db, orgId: string, opts: { aktive?: boolean } = {}) {
  const betingelser = [eq(vendors.orgId, orgId)];
  if (opts.aktive !== undefined) betingelser.push(eq(vendors.active, opts.aktive));
  const rader = await db
    .select()
    .from(vendors)
    .where(and(...betingelser))
    .orderBy(asc(vendors.name));

  const [avtaler, oppgaver, primaerkontakter] = await Promise.all([
    db
      .select({ vendorId: contracts.vendorId, antall: count() })
      .from(contracts)
      .where(and(eq(contracts.orgId, orgId), isNull(contracts.archivedAt)))
      .groupBy(contracts.vendorId),
    db
      .select({ vendorId: tasks.vendorId, antall: count() })
      .from(tasks)
      .where(and(eq(tasks.orgId, orgId), eq(tasks.active, true), isNotNull(tasks.vendorId)))
      .groupBy(tasks.vendorId),
    // Kontakttabellen har ingen org-kolonne — org-avgrensningen går via leverandøren.
    db
      .select({ vendorId: vendorContacts.vendorId, name: vendorContacts.name })
      .from(vendorContacts)
      .innerJoin(vendors, eq(vendors.id, vendorContacts.vendorId))
      .where(and(eq(vendors.orgId, orgId), eq(vendorContacts.isPrimary, true))),
  ]);

  const antallAvtaler = new Map(avtaler.map((r) => [r.vendorId, r.antall]));
  const antallOppgaver = new Map(oppgaver.map((r) => [r.vendorId, r.antall]));
  const primaerkontakt = new Map(primaerkontakter.map((r) => [r.vendorId, r.name]));

  return rader.map((v) => ({
    ...v,
    primaryContactName: primaerkontakt.get(v.id) ?? null,
    antallKontrakter: antallAvtaler.get(v.id) ?? 0,
    antallOppgaver: antallOppgaver.get(v.id) ?? 0,
  }));
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

/**
 * Samme org.nr. to ganger i samme organisasjon er nesten alltid et dobbeltklikk eller en
 * glemt registrering — ikke to reelle forhold. Brreg-søket i «Ny leverandør» gjør det lett
 * å treffe samme selskap igjen, så vernet ligger her og gjelder BEGGE skriveveiene.
 * Meldingen navngir den eksisterende, så man finner den i stedet for å prøve på nytt.
 */
async function krevLedigOrgnr(db: Db, orgId: string, orgNumber?: string | null, unntattId?: string) {
  if (!orgNumber) return;
  const betingelser = [eq(vendors.orgId, orgId), eq(vendors.orgNumber, orgNumber)];
  if (unntattId) betingelser.push(ne(vendors.id, unntattId));
  const rader = await db
    .select({ name: vendors.name })
    .from(vendors)
    .where(and(...betingelser))
    .limit(1);
  if (rader[0]) {
    throw new ApiFeil(409, `«${rader[0].name}» er allerede registrert med organisasjonsnummer ${orgNumber}`);
  }
}

export async function opprettLeverandor(db: Db, orgId: string, data: z.infer<typeof leverandorInn>) {
  await krevLedigOrgnr(db, orgId, data.orgNumber);
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
  await krevLedigOrgnr(db, orgId, data.orgNumber, vendorId);
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
  av: Aktor,
) {
  const leverandor = await hentLeverandor(db, orgId, vendorId);
  const [ny] = await db
    .insert(vendorAccessItems)
    .values({ id: randomUUID(), orgId, vendorId, ...data })
    .returning();
  // Nøkler og adgangspunkter er fysisk tilgang til bygget — hver endring skal kunne ettergås.
  await loggHendelse(db, orgId, av, {
    modul: "leverandorer",
    entitet: "adgang",
    entitetId: ny!.id,
    hendelse: `Registrerte adgang «${ny!.title}» hos ${leverandor.name}`,
  });
  return ny!;
}

export async function endreAdgang(
  db: Db,
  orgId: string,
  vendorId: string,
  itemId: string,
  data: Partial<z.infer<typeof adgangInn>>,
  av: Aktor,
) {
  const leverandor = await hentLeverandor(db, orgId, vendorId);
  const [endret] = await db
    .update(vendorAccessItems)
    .set(data)
    .where(and(eq(vendorAccessItems.id, itemId), eq(vendorAccessItems.vendorId, vendorId)))
    .returning();
  if (!endret) throw ikkeFunnet("Adgangselement");
  await loggHendelse(db, orgId, av, {
    modul: "leverandorer",
    entitet: "adgang",
    entitetId: itemId,
    hendelse: `Endret adgang «${endret.title}» hos ${leverandor.name}`,
  });
  return endret;
}

export async function slettAdgang(db: Db, orgId: string, vendorId: string, itemId: string, av: Aktor) {
  const leverandor = await hentLeverandor(db, orgId, vendorId);
  const slettet = await db
    .delete(vendorAccessItems)
    .where(and(eq(vendorAccessItems.id, itemId), eq(vendorAccessItems.vendorId, vendorId)))
    .returning({ id: vendorAccessItems.id, title: vendorAccessItems.title });
  if (slettet.length === 0) throw ikkeFunnet("Adgangselement");
  await loggHendelse(db, orgId, av, {
    modul: "leverandorer",
    entitet: "adgang",
    entitetId: itemId,
    hendelse: `Fjernet adgang «${slettet[0]!.title}» hos ${leverandor.name}`,
  });
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

// ---------------------------------------------------------------------------------------
// QR-informasjon til leverandøren
// ---------------------------------------------------------------------------------------

export const qrInfoInn = z.object({
  emne: z.string().trim().min(1, "Emnet kan ikke være tomt").max(200),
  tekst: z.string().trim().min(1, "Meldingen kan ikke være tom").max(20_000),
  /**
   * Adressen klienten VIL sende til. Valideres mot leverandørens registrerte kontakter — se
   * `sendQrInfo`. Feltet finnes fordi en leverandør kan ha flere kontaktpersoner, og styret
   * skal kunne velge hvem av dem som får meldingen.
   */
  til: z.string().trim().toLowerCase().email("Ugyldig e-postadresse"),
});

/**
 * Sender meldingen om QR-kvittering til leverandøren, på styrets vegne.
 *
 * ## Mottakeren bestemmes av SERVEREN, ikke av kroppen
 *
 * Teksten og emnet kommer fra klienten — det er meningen, styret redigerer meldingen før den
 * går. Men adressen gjør ikke: den må finnes blant leverandørens registrerte kontakter, eller
 * være leverandørens egen adresse. Uten den sjekken er dette endepunktet en åpen e-postrelé for
 * enhver innlogget bruker: send hva som helst til hvem som helst, fra vårt verifiserte domene.
 * Det er en spam-maskin med vår avsenderreputasjon som innsats.
 *
 * ## Reply-To, ikke From
 *
 * E-posten går fra `noreply@driftiq.no`, fordi det er det domenet som er verifisert hos Resend.
 * Å sette `From` til styremedlemmets adresse ville krevd at DE verifiserte domenet sitt hos oss,
 * og uten det havner meldingen i søppelpost (SPF/DKIM stemmer ikke). Reply-To løser det som
 * betyr noe: leverandøren svarer til et menneske.
 *
 * ## Sendingen loggføres som notat
 *
 * På leverandøren, i den append-only notatloggen. Ellers vet ingen om meldingen er sendt — og
 * da blir den enten sendt tre ganger, eller aldri fordi alle tror en annen gjorde det.
 */
export async function sendQrInfo(
  db: Db,
  orgId: string,
  vendorId: string,
  avsender: { navn: string; epost: string | null },
  data: z.infer<typeof qrInfoInn>,
) {
  const lev = await hentLeverandor(db, orgId, vendorId);

  // KONTAKTPERSONENES adresser. Leverandøren selv har ingen e-postkolonne — v1s
  // `contact_email` ble erstattet av `vendorContacts`, se kommentaren på tabellen.
  const lovlige = new Set(
    lev.kontakter
      .map((k) => k.email)
      .filter((e): e is string => Boolean(e))
      .map((e) => e.trim().toLowerCase()),
  );
  if (!lovlige.has(data.til)) {
    throw ugyldig(
      "Adressen er ikke registrert på en kontaktperson hos leverandøren. Legg den inn først.",
    );
  }

  // Sendes ETTER at notatet er skrevet, gjennom kallstedets `etterCommit`: e-post er en
  // sidevirkning, og en Resend-feil skal ikke rulle tilbake loggføringen av at vi forsøkte.
  await leggTilNotat(db, orgId, vendorId, avsender.navn, {
    text: `Sendte info om QR-kvittering til ${data.til}.`,
  });

  return { til: data.til, emne: data.emne, tekst: data.tekst, svarTil: avsender.epost };
}
