/**
 * Henvendelser fra landingssiden.
 *
 * ## Offentlig og uautentisert
 *
 * Å kreve konto for å ta kontakt ville vært absurd, så skjemaet er åpent. Beskyttelsen mot
 * søppel er en **honningkrukke**: et felt som er skjult for mennesker, men som skjemaroboter
 * fyller ut fordi de leser HTML-en og ikke CSS-en. Er det utfylt, later vi som alt gikk bra
 * og lagrer ingenting — en robot som får en feilmelding, prøver på nytt med en annen taktikk.
 *
 * Bevisst ikke CAPTCHA: det ville sendt besøkendes data til en tredjepart, og lagt en
 * hindring foran nettopp den som vil snakke med oss.
 */

import { desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "../db/client";
import { leadActivities, leads } from "../db/schema/leads";
import { organizations } from "../db/schema/organizations";
import type { Aktor } from "./aktor";
import { ApiFeil, ikkeFunnet } from "./api";
import { hentEnhet } from "./brreg";

export const leadInn = z.object({
  name: z.string().trim().min(1, "Navn må fylles ut"),
  email: z.string().trim().toLowerCase().email("Ugyldig e-postadresse"),
  phone: z.string().trim().max(40).nullish(),
  company: z.string().trim().max(200).nullish(),
  message: z.string().trim().max(4000).nullish(),
  /** Honningkrukka. Skal ALLTID være tom fra et menneske. Se kommentaren øverst. */
  felle: z.string().max(200).optional(),

  /* Fra Enhetsregisteret, når besøkende har valgt laget sitt i søket. */
  orgNr: z.string().trim().max(20).nullish(),
  orgForm: z.string().trim().max(120).nullish(),
  kommune: z.string().trim().max(120).nullish(),
  adresse: z.string().trim().max(300).nullish(),
  postnummer: z.string().trim().max(20).nullish(),
  poststed: z.string().trim().max(120).nullish(),
  brregEpost: z.string().trim().max(200).nullish(),
  brregTelefon: z.string().trim().max(60).nullish(),
  brregNettsted: z.string().trim().max(300).nullish(),
  brregRaa: z.string().max(20000).nullish(),
});

/**
 * Statusverdiene i databasen → ordet i loggen og panelet. Speiles i `STATUS` på
 * leads-siden — endres en etikett, må begge med (loggen skriver ordet inn i raden).
 */
const STATUS_ETIKETT: Record<string, string> = {
  ny: "Ny",
  kontaktet: "Kontaktet",
  kvalifisert: "Kvalifisert",
  avslatt: "Avslått",
  konvertert: "Kunde",
};

/**
 * Radene som går tilbake til panelet, uten `brregRaa` — det rå registersvaret kan være
 * 20 kB og har ingen rolle der (samme grunn som utplukket i `hentLeads`).
 */
function utenRaa<T extends { brregRaa?: string | null }>(rad: T): Omit<T, "brregRaa"> {
  const kopi = { ...rad };
  delete kopi.brregRaa;
  return kopi;
}

/** Én rad i aktivitetsloggen. `aktor: null` = systemet selv (landingssiden). */
async function loggAktivitet(
  db: Db,
  leadId: string,
  tekst: string,
  note: string | null,
  aktor: Aktor | null,
) {
  await db.insert(leadActivities).values({
    id: randomUUID(),
    leadId,
    text: tekst,
    note,
    actorName: aktor?.navn ?? null,
    actorUserId: aktor?.brukerId ?? null,
  });
}

export async function registrerLead(db: Db, data: z.infer<typeof leadInn>) {
  if (data.felle && data.felle.trim() !== "") {
    // Later som det gikk bra. Se kommentaren øverst.
    return { lagret: false as const };
  }

  const [rad] = await db
    .insert(leads)
    .values({
      id: randomUUID(),
      name: data.name,
      email: data.email,
      phone: data.phone ?? null,
      company: data.company ?? null,
      message: data.message ?? null,
      orgNr: data.orgNr ?? null,
      orgForm: data.orgForm ?? null,
      kommune: data.kommune ?? null,
      adresse: data.adresse ?? null,
      postnummer: data.postnummer ?? null,
      poststed: data.poststed ?? null,
      brregEpost: data.brregEpost ?? null,
      brregTelefon: data.brregTelefon ?? null,
      nettsted: data.brregNettsted ?? null,
      brregRaa: data.brregRaa ?? null,
    })
    .returning();

  await loggAktivitet(
    db,
    rad!.id,
    "Lead opprettet fra landingssiden",
    data.company && !data.orgNr ? "Laget ble ikke valgt fra Enhetsregisteret" : null,
    null,
  );

  return { lagret: true as const, lead: rad! };
}

/** Manuell registrering fra panelet — noen som ringte eller ble møtt på et arrangement. */
export const leadManuellInn = z.object({
  name: z.string().trim().min(1, "Navn må fylles ut"),
  email: z.string().trim().toLowerCase().email("Ugyldig e-postadresse"),
  phone: z.string().trim().max(40).nullish(),
  company: z.string().trim().max(200).nullish(),
  message: z.string().trim().max(4000).nullish(),
  orgNr: z.string().trim().max(20).nullish(),
});

/**
 * Oppgis org.nr, berikes leaden med et Brreg-oppslag med én gang — plattformadmin er
 * autentisert, så dette er ikke proxy-problemet fra `brreg.ts`. Et mislykket oppslag
 * stopper ikke registreringen; da står feltene tomme til noen trykker «Oppdater».
 */
export async function opprettLeadManuelt(
  db: Db,
  data: z.infer<typeof leadManuellInn>,
  aktor: Aktor,
) {
  const enhet = data.orgNr ? await hentEnhet(data.orgNr) : null;

  const [rad] = await db
    .insert(leads)
    .values({
      id: randomUUID(),
      name: data.name,
      email: data.email,
      phone: data.phone ?? null,
      company: enhet?.navn ?? data.company ?? null,
      message: data.message ?? null,
      orgNr: enhet?.orgNr ?? data.orgNr ?? null,
      orgForm: enhet?.orgForm ?? null,
      kommune: enhet?.kommune ?? null,
      adresse: enhet?.adresse ?? null,
      postnummer: enhet?.postnummer ?? null,
      poststed: enhet?.poststed ?? null,
      brregEpost: enhet?.epost ?? null,
      brregTelefon: enhet?.telefon ?? null,
      nettsted: enhet?.nettsted ?? null,
      brregRaa: enhet?.raa ?? null,
    })
    .returning();

  await loggAktivitet(db, rad!.id, "Lead lagt inn manuelt", null, aktor);
  return utenRaa(rad!);
}

export async function hentLeads(db: Db) {
  // Alt UNNTATT brregRaa: det rå registersvaret kan være 20 kB per rad og har ingen rolle i
  // panelet — det ligger i basen for den dagen noen trenger et felt vi ikke plukket ut.
  return db
    .select({
      id: leads.id,
      name: leads.name,
      email: leads.email,
      phone: leads.phone,
      company: leads.company,
      message: leads.message,
      status: leads.status,
      createdAt: leads.createdAt,
      convertedOrgId: leads.convertedOrgId,
      orgNr: leads.orgNr,
      orgForm: leads.orgForm,
      kommune: leads.kommune,
      adresse: leads.adresse,
      postnummer: leads.postnummer,
      poststed: leads.poststed,
      brregEpost: leads.brregEpost,
      brregTelefon: leads.brregTelefon,
      nettsted: leads.nettsted,
      nextAction: leads.nextAction,
      nextDate: leads.nextDate,
    })
    .from(leads)
    .orderBy(desc(leads.createdAt))
    .limit(200);
}

/**
 * «konvertert» er med vilje IKKE et gyldig valg her: den settes kun av `konverterLead`.
 * Å kunne velge den for hånd ville gitt en lead som ser ut som kunde uten kunde bak.
 *
 * `neste` skiller mellom utelatt (rør ikke), `null` (fjern oppfølgingen) og objekt (sett).
 */
export const leadOppdaterInn = z.object({
  status: z.enum(["ny", "kontaktet", "kvalifisert", "avslatt"]).optional(),
  neste: z
    .object({
      tekst: z.string().trim().min(1, "Skriv hva som er avtalt").max(200),
      dato: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ugyldig dato"),
    })
    .nullish(),
  /** Utdypning som følger loggraden — avslagsgrunnen, hva som ble avtalt. */
  notat: z.string().trim().max(2000).nullish(),
});

/**
 * Statusflytting og oppfølging, med loggen som biprodukt: hver flytting blir en rad i
 * aktivitetsloggen, så «hva har skjedd med denne leaden» aldri avhenger av at noen husket
 * å notere det. En eksplisitt fjerning av neste steg logges IKKE — «Marker som gjort»
 * skriver sin egen loggrad fra panelet, og en tom fjerning er ikke en hendelse.
 */
export async function oppdaterLead(
  db: Db,
  leadId: string,
  data: z.infer<typeof leadOppdaterInn>,
  aktor: Aktor,
) {
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) throw ikkeFunnet("Lead");

  const nyStatus = data.status && data.status !== lead.status ? data.status : null;
  if (nyStatus && lead.status === "konvertert") {
    throw new ApiFeil(400, "Leaden er konvertert til kunde og kan ikke flyttes tilbake");
  }

  const endringer: Partial<typeof leads.$inferInsert> = {};
  if (nyStatus) {
    endringer.status = nyStatus;
    // En avtalt oppfølging hører til fasen den ble satt i. Settes ikke en ny i samme
    // kall, skal den gamle ikke bli hengende igjen som om den fortsatt gjaldt.
    endringer.nextAction = null;
    endringer.nextDate = null;
  }
  if (data.neste !== undefined) {
    endringer.nextAction = data.neste?.tekst ?? null;
    endringer.nextDate = data.neste?.dato ?? null;
  }
  if (Object.keys(endringer).length === 0) return utenRaa(lead);

  const [rad] = await db.update(leads).set(endringer).where(eq(leads.id, leadId)).returning();

  if (nyStatus) {
    const tekst =
      nyStatus === "avslatt"
        ? "Avslått"
        : lead.status === "avslatt"
          ? `Gjenåpnet som ${STATUS_ETIKETT[nyStatus]}`
          : `Flyttet til ${STATUS_ETIKETT[nyStatus]}`;
    await loggAktivitet(db, leadId, tekst, data.notat ?? null, aktor);
  }
  if (data.neste) {
    await loggAktivitet(
      db,
      leadId,
      `Neste steg satt: ${data.neste.tekst}`,
      nyStatus ? null : (data.notat ?? null),
      aktor,
    );
  }
  return rad!;
}

export async function hentLeadAktiviteter(db: Db, leadId: string) {
  return db
    .select()
    .from(leadActivities)
    .where(eq(leadActivities.leadId, leadId))
    .orderBy(desc(leadActivities.createdAt))
    .limit(200);
}

export const leadNotatInn = z.object({
  tekst: z.string().trim().min(1, "Notatet kan ikke være tomt").max(2000),
});

export async function leggTilLeadNotat(db: Db, leadId: string, tekst: string, aktor: Aktor) {
  const [lead] = await db.select({ id: leads.id }).from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) throw ikkeFunnet("Lead");
  await loggAktivitet(db, leadId, tekst, null, aktor);
  return hentLeadAktiviteter(db, leadId);
}

/**
 * «Oppdater»-lenken i selskapsseksjonen: et ferskt registeroppslag på leadens org.nr.
 * Enheten kan ha byttet adresse eller forretningsfører siden innsendingen — og skal
 * leaden bli kunde, er det dagens opplysninger som gjelder.
 */
export async function oppdaterLeadBrreg(db: Db, leadId: string, aktor: Aktor) {
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) throw ikkeFunnet("Lead");
  if (!lead.orgNr) {
    throw new ApiFeil(400, "Leaden har ikke organisasjonsnummer å slå opp");
  }

  const enhet = await hentEnhet(lead.orgNr);
  if (!enhet) throw new ApiFeil(502, "Fikk ikke svar fra Enhetsregisteret");

  const [rad] = await db
    .update(leads)
    .set({
      company: enhet.navn,
      orgForm: enhet.orgForm,
      kommune: enhet.kommune,
      adresse: enhet.adresse,
      postnummer: enhet.postnummer,
      poststed: enhet.poststed,
      brregEpost: enhet.epost,
      brregTelefon: enhet.telefon,
      nettsted: enhet.nettsted,
      brregRaa: enhet.raa,
    })
    .where(eq(leads.id, leadId))
    .returning();

  await loggAktivitet(db, leadId, "Selskapsdata oppdatert fra Enhetsregisteret", null, aktor);
  return rad!;
}

export async function slettLead(db: Db, leadId: string) {
  const [rad] = await db.delete(leads).where(eq(leads.id, leadId)).returning({ id: leads.id });
  if (!rad) throw ikkeFunnet("Lead");
}

/**
 * Registerets beskrivelser («Eierseksjonssameie», «Tingsrettslig sameie») → de faste
 * verdiene kunden føres med. Samme mapping som v1s `_normaliser_org_form`, så konverterte
 * kunder får org-form på samme form som de migrerte.
 */
function normaliserOrgForm(beskrivelse: string | null | undefined): string | null {
  if (!beskrivelse) return null;
  const b = beskrivelse.toLowerCase();
  if (b.includes("borettslag")) return "Borettslag";
  if (b.includes("sameie")) return "Sameie";
  if (b.includes("boligbyggelag")) return "Boligbyggelag";
  return "Annet";
}

/** Samme regler som v1s slugging, så konverterte kunder ikke skiller seg fra de migrerte. */
function tilSlug(tekst: string): string {
  const ren = tekst
    .toLowerCase()
    .replaceAll("æ", "ae")
    .replaceAll("ø", "o")
    .replaceAll("å", "a")
    .replace(/[^a-z0-9]+/g, "-");
  return ren.replace(/^-+|-+$/g, "").slice(0, 32);
}

/**
 * «Lag kunde»: oppretter organisasjonen fra leadens felter, beriket med et FERSKT
 * Brreg-oppslag — enheten kan ha byttet styreadresse siden innsendingen. Feiler oppslaget,
 * faller vi tilbake på det leaden lagret da den kom inn.
 *
 * Kontaktpersonens egen e-post/telefon kopieres IKKE inn på organisasjonen — det er en
 * person, ikke laget. Org-kontakten er registerets (v1 gjorde det samme).
 */
export async function konverterLead(db: Db, leadId: string, aktor: Aktor) {
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) throw ikkeFunnet("Lead");
  if (lead.convertedOrgId) throw new ApiFeil(400, "Leaden er allerede konvertert til kunde");
  if (lead.orgNr) {
    const [eksisterende] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.orgNr, lead.orgNr))
      .limit(1);
    if (eksisterende) throw new ApiFeil(400, "Det finnes allerede en kunde med dette org.nr");
  }

  const enhet = lead.orgNr ? await hentEnhet(lead.orgNr) : null;
  const navn = enhet?.navn ?? ((lead.company ?? "").trim() || lead.name);

  // Org.nr som slug når det finnes (samme regel som de migrerte kundene), ellers navnet —
  // med teller-suffiks ved kollisjon i stedet for å stoppe konverteringen.
  const grunnslug = lead.orgNr ?? (tilSlug(navn) || "kunde");
  let slug = grunnslug;
  for (let n = 2; ; n++) {
    const [opptatt] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, slug))
      .limit(1);
    if (!opptatt) break;
    slug = `${grunnslug}-${n}`;
  }

  const [org] = await db
    .insert(organizations)
    .values({
      id: randomUUID(),
      name: navn,
      slug,
      orgNr: lead.orgNr,
      orgForm: normaliserOrgForm(enhet?.orgForm ?? lead.orgForm),
      municipality: enhet?.kommune ?? lead.kommune,
      phone: enhet?.telefon ?? lead.brregTelefon,
      contactEmail: enhet?.epost ?? lead.brregEpost,
      website: enhet?.nettsted ?? lead.nettsted,
    })
    .returning({ id: organizations.id, name: organizations.name });

  await db
    .update(leads)
    .set({ convertedOrgId: org!.id, status: "konvertert", nextAction: null, nextDate: null })
    .where(eq(leads.id, leadId));

  await loggAktivitet(db, leadId, "Opprettet som kunde", org!.name, aktor);
  return org!;
}
