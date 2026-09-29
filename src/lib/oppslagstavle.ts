/**
 * Oppslagstavla — infoskjermer i oppgangen. Designnotatet er `docs/oppslagstavle.md`.
 *
 * To innganger:
 *
 * - **Styret**, gjennom `orgRute` som alle andre moduler: oppslag, kalender, skjermer og
 *   utseende. Kobling og fjerning av skjermer krever orgadmin — en skjerm er en lisens på
 *   fakturaen og en enhet som kan lese borettslagets oppslag.
 * - **Skjermen**, anonymt under `/api/skjerm/`: den har ingen konto, bare et enhetstoken.
 *   Tokenet slås opp med `withoutRls("skjerm")` fordi org-en ikke er kjent før raden er
 *   funnet — og ALT annet skjermen leser, går deretter gjennom `withOrg` som i appen. Unntaket
 *   er altså ett oppslag på én kolonne, ikke en sesjon uten isolasjon.
 *
 * ## Tokenet
 *
 * 32 tilfeldige byte, base64url. Bare sha256 lagres (`device_token_hash`) — tokenet selv
 * finnes kun i skjermens nettleser. Fjernes skjermen i appen, er raden borte og neste
 * forespørsel svarer 401; skjermen går da tilbake til koblingsbildet av seg selv.
 */

import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { and, asc, desc, eq, gte, lte, lt } from "drizzle-orm";
import { z } from "zod";
import { withOrg, withoutRls, type Db } from "../db/client";
import { organizations } from "../db/schema/organizations";
import {
  boardContacts,
  boardEvents,
  boardPairings,
  boardPosts,
  boardScreens,
  boardSettings,
  type BoardScreen,
} from "../db/schema/oppslagstavle";
import { ApiFeil, ikkeFunnet, ugyldig, type Filsvar } from "./api";
import type { Aktor } from "./aktor";
import { tommedagerForSkjerm } from "./birkobling";
import { loggHendelse } from "./hendelser";
import { filSti, lagreFil, slettFil } from "./lagring";
import {
  FELT,
  KATEGORIER,
  KODE_ALFABET,
  KODE_LENGDE,
  NEDE_ETTER_SEKUNDER,
  RETNINGER,
  STANDARD_SEKUNDER,
  STANDARD_UTSEENDE,
  VISNINGSTIDER,
  erHexfarge,
  lesFelt,
  normaliserKode,
  oppslagStatus,
  osloIDag,
  type Kategori,
  type Oppslagstype,
  type Retning,
  type Skjerminnhold,
} from "./oppslagstavleregler";

/** Katalogen under `uploads/orgs/{orgId}/`. */
const MAPPE = "oppslagstavle";
const BILDETYPER = ["image/jpeg", "image/png", "image/webp"] as const;
const LOGOTYPER = ["image/png", "image/jpeg", "image/webp"] as const;
const MAKS_BILDE = 10 * 1024 * 1024;
const MAKS_LOGO = 2 * 1024 * 1024;

/** Hvor lenge en koblingskode gjelder. Skjermen henter en ny når den går ut. */
const KODE_GYLDIG_MINUTTER = 15;

const hash = (s: string) => createHash("sha256").update(s).digest("hex");

// ---------------------------------------------------------------------------------------
// Oppslag
// ---------------------------------------------------------------------------------------

const dato = z.string().date("Ugyldig dato");

export const oppslagInn = z
  .object({
    tittel: z.string().trim().min(1, "Skriv en overskrift").max(80, "Overskriften er for lang (maks 80 tegn)"),
    tekst: z.string().trim().max(400, "Teksten er for lang (maks 400 tegn)").nullish(),
    kategori: z.enum(KATEGORIER).nullish(),
    fra: dato,
    til: dato,
    alleSkjermer: z.boolean(),
    skjermIder: z.array(z.string()).default([]),
    sekunder: z
      .number()
      .int()
      .refine((n) => (VISNINGSTIDER as readonly number[]).includes(n), "Ugyldig visningstid")
      .default(STANDARD_SEKUNDER),
  })
  .refine((d) => d.til >= d.fra, { message: "«Til og med» kan ikke være før «Vis fra»", path: ["til"] })
  .refine((d) => d.alleSkjermer || d.skjermIder.length > 0, {
    message: "Velg minst én skjerm",
    path: ["skjermIder"],
  });
export type OppslagInn = z.infer<typeof oppslagInn>;

/** Skjermene i utvalget må tilhøre org-en — ellers kunne et oppslag pekt på en annens skjerm. */
async function validerSkjermer(db: Db, orgId: string, ider: string[]) {
  if (ider.length === 0) return;
  const finnes = await db
    .select({ id: boardScreens.id })
    .from(boardScreens)
    .where(eq(boardScreens.orgId, orgId));
  const kjente = new Set(finnes.map((s) => s.id));
  if (ider.some((id) => !kjente.has(id))) throw ugyldig("Ukjent skjerm i utvalget");
}

export async function hentOppslag(db: Db, orgId: string) {
  const iDag = osloIDag();
  const rader = await db
    .select({
      id: boardPosts.id,
      kind: boardPosts.kind,
      title: boardPosts.title,
      body: boardPosts.body,
      category: boardPosts.category,
      originalName: boardPosts.originalName,
      showFrom: boardPosts.showFrom,
      showUntil: boardPosts.showUntil,
      allScreens: boardPosts.allScreens,
      screenIds: boardPosts.screenIds,
      displaySeconds: boardPosts.displaySeconds,
      createdBy: boardPosts.createdBy,
      createdAt: boardPosts.createdAt,
    })
    .from(boardPosts)
    .where(eq(boardPosts.orgId, orgId))
    .orderBy(desc(boardPosts.showFrom), desc(boardPosts.createdAt));
  return rader.map((r) => ({ ...r, status: oppslagStatus(r, iDag) }));
}

export async function opprettOppslag(
  db: Db,
  orgId: string,
  av: Aktor,
  type: Oppslagstype,
  data: OppslagInn,
  fil: File | null,
) {
  await validerSkjermer(db, orgId, data.skjermIder);
  if (type === "bilde" && !fil) throw ugyldig("Velg et bilde");

  const lagret =
    type === "bilde" && fil
      ? await lagreFil(db, orgId, MAPPE, fil, { typer: BILDETYPER, maksStorrelse: MAKS_BILDE })
      : null;

  const [rad] = await db
    .insert(boardPosts)
    .values({
      id: randomUUID(),
      orgId,
      kind: type,
      title: data.tittel,
      body: type === "tekst" ? (data.tekst ?? null) : null,
      category: type === "tekst" ? (data.kategori ?? "info") : null,
      fileName: lagret?.filnavn ?? null,
      originalName: lagret?.originalnavn ?? null,
      contentType: lagret?.contentType ?? null,
      fileSize: lagret?.storrelse ?? null,
      displaySeconds: data.sekunder,
      showFrom: data.fra,
      showUntil: data.til,
      allScreens: data.alleSkjermer,
      screenIds: data.alleSkjermer ? [] : data.skjermIder,
      createdBy: av.navn,
      createdByUserId: av.brukerId,
    })
    .returning();
  return rad!;
}

/**
 * Endrer et oppslag — tekst, periode, skjermer og visningstid. Typen og bildet står fast;
 * et nytt bilde er et nytt oppslag.
 */
export async function endreOppslag(db: Db, orgId: string, id: string, data: OppslagInn) {
  await validerSkjermer(db, orgId, data.skjermIder);
  const [eksisterende] = await db
    .select({ kind: boardPosts.kind })
    .from(boardPosts)
    .where(and(eq(boardPosts.id, id), eq(boardPosts.orgId, orgId)))
    .limit(1);
  if (!eksisterende) throw ikkeFunnet("Oppslag");
  const tekst = eksisterende.kind === "tekst";
  const [rad] = await db
    .update(boardPosts)
    .set({
      title: data.tittel,
      body: tekst ? (data.tekst ?? null) : null,
      category: tekst ? (data.kategori ?? "info") : null,
      displaySeconds: data.sekunder,
      showFrom: data.fra,
      showUntil: data.til,
      allScreens: data.alleSkjermer,
      screenIds: data.alleSkjermer ? [] : data.skjermIder,
    })
    .where(and(eq(boardPosts.id, id), eq(boardPosts.orgId, orgId)))
    .returning();
  return rad!;
}

/**
 * Sletter oppslaget OG bildet. Motsatt av avviksvedleggene, som blir liggende: et oppslag er
 * kunngjøring, ikke dokumentasjon, og et utløpt dugnadsbilde skal ikke spise av kvoten.
 */
export async function slettOppslag(db: Db, orgId: string, id: string) {
  const [rad] = await db
    .delete(boardPosts)
    .where(and(eq(boardPosts.id, id), eq(boardPosts.orgId, orgId)))
    .returning({ fileName: boardPosts.fileName });
  if (!rad) throw ikkeFunnet("Oppslag");
  if (rad.fileName) await slettFil(orgId, MAPPE, rad.fileName);
}

export async function hentOppslagFil(db: Db, orgId: string, id: string): Promise<Filsvar> {
  const [rad] = await db
    .select({ fileName: boardPosts.fileName, originalName: boardPosts.originalName, contentType: boardPosts.contentType })
    .from(boardPosts)
    .where(and(eq(boardPosts.id, id), eq(boardPosts.orgId, orgId)))
    .limit(1);
  if (!rad?.fileName) throw ikkeFunnet("Bilde");
  return lesFil(orgId, rad.fileName, rad.originalName ?? "bilde", rad.contentType);
}

async function lesFil(orgId: string, filnavn: string, navn: string, type: string | null): Promise<Filsvar> {
  try {
    return { innhold: await readFile(filSti(orgId, MAPPE, filnavn)), navn, contentType: type, disposition: "inline" };
  } catch {
    throw new ApiFeil(404, "Fil ikke funnet på disk");
  }
}

// ---------------------------------------------------------------------------------------
// Kalender
// ---------------------------------------------------------------------------------------

export const hendelseInn = z.object({
  tittel: z.string().trim().min(1, "Skriv hva som skjer").max(60, "Maks 60 tegn"),
  dato,
  tid: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Ugyldig klokkeslett")
    .nullish()
    .or(z.literal("").transform(() => null)),
  sted: z.string().trim().max(50, "Maks 50 tegn").nullish(),
});

/** Kommende hendelser (i dag og framover). Passerte hendelser har ingen plass på tavla. */
export async function hentHendelser(db: Db, orgId: string) {
  return db
    .select()
    .from(boardEvents)
    .where(and(eq(boardEvents.orgId, orgId), gte(boardEvents.eventDate, osloIDag())))
    .orderBy(asc(boardEvents.eventDate), asc(boardEvents.eventTime));
}

export async function opprettHendelse(db: Db, orgId: string, av: Aktor, d: z.infer<typeof hendelseInn>) {
  const [rad] = await db
    .insert(boardEvents)
    .values({
      id: randomUUID(),
      orgId,
      title: d.tittel,
      eventDate: d.dato,
      eventTime: d.tid ?? null,
      place: d.sted || null,
      createdBy: av.navn,
      createdByUserId: av.brukerId,
    })
    .returning();
  return rad!;
}

export async function slettHendelse(db: Db, orgId: string, id: string) {
  const slettet = await db
    .delete(boardEvents)
    .where(and(eq(boardEvents.id, id), eq(boardEvents.orgId, orgId)))
    .returning({ id: boardEvents.id });
  if (slettet.length === 0) throw ikkeFunnet("Hendelse");
}

// ---------------------------------------------------------------------------------------
// Skjermer
// ---------------------------------------------------------------------------------------

function skjermUt(s: BoardScreen, naa = new Date()) {
  const sistSett = s.lastSeenAt;
  const paaNett = sistSett !== null && naa.getTime() - sistSett.getTime() < NEDE_ETTER_SEKUNDER * 1000;
  return {
    id: s.id,
    navn: s.name,
    adresse: s.address,
    retning: (RETNINGER as readonly string[]).includes(s.orientation) ? (s.orientation as Retning) : "staende",
    felt: lesFelt(s.fields),
    sistSett: sistSett?.toISOString() ?? null,
    paaNett,
    koblet: s.createdAt.toISOString(),
  };
}

export async function hentSkjermer(db: Db, orgId: string) {
  const rader = await db
    .select()
    .from(boardScreens)
    .where(eq(boardScreens.orgId, orgId))
    .orderBy(asc(boardScreens.createdAt));
  return rader.map((s) => skjermUt(s));
}

const skjermFelter = {
  navn: z.string().trim().min(1, "Gi skjermen et navn").max(40, "Maks 40 tegn"),
  adresse: z.string().trim().max(60, "Maks 60 tegn").nullish(),
  retning: z.enum(RETNINGER),
};

export const koblingInn = z.object({ kode: z.string(), ...skjermFelter });

export const skjermEndring = z.object({
  ...skjermFelter,
  felt: z.array(z.enum(FELT)),
});

/**
 * Styret skriver inn koden skjermen viser. Skjermen får ikke tokenet her — det henter den
 * selv med hemmeligheten sin (`sjekkKobling`), så tokenet aldri passerer styrets nettleser.
 */
export async function kobleSkjerm(db: Db, orgId: string, av: Aktor, d: z.infer<typeof koblingInn>) {
  const kode = normaliserKode(d.kode);
  if (kode.length !== KODE_LENGDE) throw ugyldig("Koden må ha seks tegn, for eksempel K7M-4QX.");

  const [kobling] = await db.select().from(boardPairings).where(eq(boardPairings.code, kode)).limit(1);
  // Samme melding for ukjent, utløpt og allerede brukt: en gjetter skal ikke lære noe.
  if (!kobling || kobling.screenId || kobling.expiresAt < new Date()) {
    throw ugyldig("Fant ingen skjerm med den koden. Sjekk at koden på skjermen er den samme, og prøv igjen.");
  }

  const id = randomUUID();
  const [skjerm] = await db
    .insert(boardScreens)
    .values({
      id,
      orgId,
      name: d.navn,
      address: d.adresse || null,
      orientation: d.retning,
      fields: JSON.stringify(FELT),
      // Plassholder til skjermen henter sitt ekte token: hashen av et token ingen har fått,
      // så raden kan ikke brukes av noen fram til da.
      deviceTokenHash: hash(randomBytes(32).toString("base64url")),
      pairedBy: av.navn,
      pairedByUserId: av.brukerId,
    })
    .returning();
  await db.update(boardPairings).set({ screenId: id }).where(eq(boardPairings.code, kode));

  await loggHendelse(db, orgId, av, {
    modul: "oppslagstavle",
    entitet: "skjerm",
    entitetId: id,
    hendelse: `Koblet til skjermen «${d.navn}»`,
  });
  return skjermUt(skjerm!);
}

export async function endreSkjerm(db: Db, orgId: string, id: string, d: z.infer<typeof skjermEndring>) {
  const [rad] = await db
    .update(boardScreens)
    .set({
      name: d.navn,
      address: d.adresse || null,
      orientation: d.retning,
      fields: JSON.stringify(d.felt),
    })
    .where(and(eq(boardScreens.id, id), eq(boardScreens.orgId, orgId)))
    .returning();
  if (!rad) throw ikkeFunnet("Skjerm");
  return skjermUt(rad);
}

/** Fjerner skjermen og dermed tokenet — skjermen faller tilbake til koblingsbildet. */
export async function slettSkjerm(db: Db, orgId: string, av: Aktor, id: string) {
  const [rad] = await db
    .delete(boardScreens)
    .where(and(eq(boardScreens.id, id), eq(boardScreens.orgId, orgId)))
    .returning({ name: boardScreens.name });
  if (!rad) throw ikkeFunnet("Skjerm");
  await loggHendelse(db, orgId, av, {
    modul: "oppslagstavle",
    entitet: "skjerm",
    entitetId: id,
    hendelse: `Fjernet skjermen «${rad.name}»`,
  });
}

// ---------------------------------------------------------------------------------------
// Kontaktpersoner
// ---------------------------------------------------------------------------------------

export const kontaktInn = z
  .object({
    navn: z.string().trim().min(1, "Skriv navnet").max(60, "Maks 60 tegn"),
    rolle: z.string().trim().max(40, "Maks 40 tegn").nullish(),
    telefon: z.string().trim().max(30, "Maks 30 tegn").nullish(),
    epost: z.string().trim().max(80, "Maks 80 tegn").nullish(),
  })
  .refine((d) => d.telefon || d.epost, { message: "Oppgi telefon eller e-post", path: ["telefon"] });
export type KontaktInn = z.infer<typeof kontaktInn>;

const kontaktUt = (k: typeof boardContacts.$inferSelect) => ({
  id: k.id,
  navn: k.name,
  rolle: k.role,
  telefon: k.phone,
  epost: k.email,
  harBilde: Boolean(k.fileName),
  bildeVersjon: k.fileName?.slice(0, 8) ?? null,
});

async function kontaktRader(db: Db, orgId: string) {
  return db
    .select()
    .from(boardContacts)
    .where(eq(boardContacts.orgId, orgId))
    .orderBy(asc(boardContacts.sortOrder), asc(boardContacts.createdAt));
}

export async function hentKontakter(db: Db, orgId: string) {
  return (await kontaktRader(db, orgId)).map(kontaktUt);
}

async function enKontakt(db: Db, orgId: string, id: string) {
  const [k] = await db
    .select()
    .from(boardContacts)
    .where(and(eq(boardContacts.id, id), eq(boardContacts.orgId, orgId)))
    .limit(1);
  if (!k) throw ikkeFunnet("Kontaktperson");
  return k;
}

const lagreBilde = (db: Db, orgId: string, fil: File, erstatter: number | null) =>
  lagreFil(db, orgId, MAPPE, fil, { typer: BILDETYPER, maksStorrelse: MAKS_LOGO, erstatter });

export async function opprettKontakt(db: Db, orgId: string, d: KontaktInn, fil: File | null) {
  const lagret = fil ? await lagreBilde(db, orgId, fil, null) : null;
  const eksisterende = await kontaktRader(db, orgId);
  const [rad] = await db
    .insert(boardContacts)
    .values({
      id: randomUUID(),
      orgId,
      name: d.navn,
      role: d.rolle || null,
      phone: d.telefon || null,
      email: d.epost || null,
      fileName: lagret?.filnavn ?? null,
      contentType: lagret?.contentType ?? null,
      fileSize: lagret?.storrelse ?? null,
      sortOrder: eksisterende.length,
    })
    .returning();
  return kontaktUt(rad!);
}

export async function endreKontakt(db: Db, orgId: string, id: string, d: KontaktInn) {
  await enKontakt(db, orgId, id);
  const [rad] = await db
    .update(boardContacts)
    .set({ name: d.navn, role: d.rolle || null, phone: d.telefon || null, email: d.epost || null })
    .where(and(eq(boardContacts.id, id), eq(boardContacts.orgId, orgId)))
    .returning();
  return kontaktUt(rad!);
}

/** Bytter bildet, eller fjerner det når `fil` er null. Det gamle slettes fra disk. */
export async function settKontaktbilde(db: Db, orgId: string, id: string, fil: File | null) {
  const gammel = await enKontakt(db, orgId, id);
  const lagret = fil ? await lagreBilde(db, orgId, fil, gammel.fileSize) : null;
  const [rad] = await db
    .update(boardContacts)
    .set({
      fileName: lagret?.filnavn ?? null,
      contentType: lagret?.contentType ?? null,
      fileSize: lagret?.storrelse ?? null,
    })
    .where(and(eq(boardContacts.id, id), eq(boardContacts.orgId, orgId)))
    .returning();
  if (gammel.fileName) await slettFil(orgId, MAPPE, gammel.fileName);
  return kontaktUt(rad!);
}

/** Flytter en kontaktperson ett hakk opp eller ned i rotasjonen. */
export async function flyttKontakt(db: Db, orgId: string, id: string, retning: "opp" | "ned") {
  const liste = await kontaktRader(db, orgId);
  const i = liste.findIndex((k) => k.id === id);
  if (i < 0) throw ikkeFunnet("Kontaktperson");
  const j = retning === "opp" ? i - 1 : i + 1;
  if (j >= 0 && j < liste.length) [liste[i], liste[j]] = [liste[j]!, liste[i]!];
  // Nummereres på nytt fra 0 — eldre rader med lik `sort_order` får da en entydig rekkefølge.
  for (const [n, k] of liste.entries()) {
    await db.update(boardContacts).set({ sortOrder: n }).where(and(eq(boardContacts.id, k.id), eq(boardContacts.orgId, orgId)));
  }
  return hentKontakter(db, orgId);
}

export async function slettKontakt(db: Db, orgId: string, id: string) {
  const k = await enKontakt(db, orgId, id);
  await db.delete(boardContacts).where(and(eq(boardContacts.id, id), eq(boardContacts.orgId, orgId)));
  if (k.fileName) await slettFil(orgId, MAPPE, k.fileName);
}

export async function hentKontaktbilde(db: Db, orgId: string, id: string): Promise<Filsvar> {
  const k = await enKontakt(db, orgId, id);
  if (!k.fileName) throw ikkeFunnet("Bilde");
  return lesFil(orgId, k.fileName, "kontakt", k.contentType);
}

// ---------------------------------------------------------------------------------------
// Utseende
// ---------------------------------------------------------------------------------------

export const utseendeInn = z.object({
  background: z.string().refine(erHexfarge, "Ugyldig farge"),
  accent: z.string().refine(erHexfarge, "Ugyldig farge"),
  offlineMode: z.enum(["siste", "melding"]),
});

export async function hentUtseende(db: Db, orgId: string) {
  const [rad] = await db.select().from(boardSettings).where(eq(boardSettings.orgId, orgId)).limit(1);
  return {
    background: rad?.background ?? STANDARD_UTSEENDE.background,
    accent: rad?.accent ?? STANDARD_UTSEENDE.accent,
    offlineMode: (rad?.offlineMode === "melding" ? "melding" : "siste") as "siste" | "melding",
    harLogo: Boolean(rad?.fileName),
  };
}

export async function lagreUtseende(db: Db, orgId: string, d: z.infer<typeof utseendeInn>) {
  await db
    .insert(boardSettings)
    .values({ orgId, ...d })
    .onConflictDoUpdate({ target: boardSettings.orgId, set: { ...d, updatedAt: new Date() } });
  return hentUtseende(db, orgId);
}

export async function lastOppLogo(db: Db, orgId: string, fil: File) {
  const [gammel] = await db.select().from(boardSettings).where(eq(boardSettings.orgId, orgId)).limit(1);
  const lagret = await lagreFil(db, orgId, MAPPE, fil, {
    typer: LOGOTYPER,
    maksStorrelse: MAKS_LOGO,
    erstatter: gammel?.fileSize ?? null,
  });
  const logo = { fileName: lagret.filnavn, contentType: lagret.contentType, fileSize: lagret.storrelse };
  await db
    .insert(boardSettings)
    .values({ orgId, ...STANDARD_UTSEENDE, ...logo })
    .onConflictDoUpdate({ target: boardSettings.orgId, set: { ...logo, updatedAt: new Date() } });
  if (gammel?.fileName) await slettFil(orgId, MAPPE, gammel.fileName);
  return hentUtseende(db, orgId);
}

export async function slettLogo(db: Db, orgId: string) {
  const [gammel] = await db.select().from(boardSettings).where(eq(boardSettings.orgId, orgId)).limit(1);
  if (!gammel?.fileName) return hentUtseende(db, orgId);
  await db
    .update(boardSettings)
    .set({ fileName: null, contentType: null, fileSize: null, updatedAt: new Date() })
    .where(eq(boardSettings.orgId, orgId));
  await slettFil(orgId, MAPPE, gammel.fileName);
  return hentUtseende(db, orgId);
}

export async function hentLogo(db: Db, orgId: string): Promise<Filsvar> {
  const [rad] = await db.select().from(boardSettings).where(eq(boardSettings.orgId, orgId)).limit(1);
  if (!rad?.fileName) throw ikkeFunnet("Logo");
  return lesFil(orgId, rad.fileName, "logo", rad.contentType);
}

// ---------------------------------------------------------------------------------------
// Det skjermen viser
// ---------------------------------------------------------------------------------------

function initialer(navn: string): string {
  // Bare ord med bokstaver: «DEMO - Det Beste» ga «D-» da bindestreken talte som et ord.
  const ord = navn
    .replace(/\b(borettslag|sameie|brl|as)\b/gi, "")
    .split(/\s+/)
    .filter((o) => /\p{L}/u.test(o));
  return (ord.length >= 2 ? ord[0]![0]! + ord[1]![0]! : (ord[0] ?? navn).slice(0, 2)).toUpperCase();
}

/**
 * Alt én skjerm skal vise akkurat nå. Brukes av skjermen selv og av forhåndsvisningen i
 * appen — samme funksjon, så forhåndsvisningen kan ikke vise noe annet enn veggen.
 */
export async function byggSkjerminnhold(db: Db, orgId: string, skjermId: string): Promise<Skjerminnhold> {
  const [skjerm] = await db
    .select()
    .from(boardScreens)
    .where(and(eq(boardScreens.id, skjermId), eq(boardScreens.orgId, orgId)))
    .limit(1);
  if (!skjerm) throw ikkeFunnet("Skjerm");
  const s = skjermUt(skjerm);

  const [org] = await db
    .select({ navn: organizations.name, telefon: organizations.phone, epost: organizations.contactEmail })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  const iDag = osloIDag();
  const oppslag = s.felt.includes("oppslag")
    ? await db
        .select()
        .from(boardPosts)
        .where(and(eq(boardPosts.orgId, orgId), lte(boardPosts.showFrom, iDag), gte(boardPosts.showUntil, iDag)))
        .orderBy(desc(boardPosts.showFrom), desc(boardPosts.createdAt))
    : [];

  const hendelser = s.felt.includes("kalender")
    ? await db
        .select()
        .from(boardEvents)
        .where(and(eq(boardEvents.orgId, orgId), gte(boardEvents.eventDate, iDag)))
        .orderBy(asc(boardEvents.eventDate), asc(boardEvents.eventTime))
        .limit(5)
    : [];

  const utseende = await hentUtseende(db, orgId);

  return {
    skjerm: { id: s.id, navn: s.navn, adresse: s.adresse, retning: s.retning, felt: s.felt },
    org: {
      navn: org?.navn ?? "",
      initialer: initialer(org?.navn ?? "?"),
      telefon: org?.telefon ?? null,
      epost: org?.epost ?? null,
    },
    utseende,
    oppslag: oppslag
      .filter((p) => p.allScreens || p.screenIds.includes(skjermId))
      .map((p) => ({
        id: p.id,
        type: p.kind as Oppslagstype,
        tittel: p.title,
        tekst: p.body,
        kategori: (p.category as Kategori | null) ?? null,
        harFil: Boolean(p.fileName),
        sekunder: p.displaySeconds,
      })),
    kontakter: s.felt.includes("kontakt") ? await hentKontakter(db, orgId) : [],
    avfall: s.felt.includes("avfall") ? await tommedagerForSkjerm(db, orgId) : null,
    hendelser: hendelser.map((h) => ({
      id: h.id,
      tittel: h.title,
      dato: h.eventDate,
      tid: h.eventTime,
      sted: h.place,
    })),
    hentet: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------------------
// Den anonyme skjermen
// ---------------------------------------------------------------------------------------

function nyKode(): string {
  let k = "";
  for (let i = 0; i < KODE_LENGDE; i++) k += KODE_ALFABET[randomInt(KODE_ALFABET.length)];
  return k;
}

/**
 * En ny skjerm ber om en koblingskode. Utløpte koder ryddes samtidig — tabellen skal ikke
 * vokse av skjermer som sto på i en uke uten å bli koblet.
 */
export async function startKobling() {
  return withoutRls("skjerm", async (db) => {
    await db.delete(boardPairings).where(lt(boardPairings.expiresAt, new Date()));
    const hemmelighet = randomBytes(32).toString("base64url");
    const utloper = new Date(Date.now() + KODE_GYLDIG_MINUTTER * 60_000);
    // Kollisjon i 31^6 ≈ 900 millioner er usannsynlig, men primærnøkkelen avgjør — prøv igjen.
    for (let forsok = 0; forsok < 5; forsok++) {
      const kode = nyKode();
      const rader = await db
        .insert(boardPairings)
        .values({ code: kode, secretHash: hash(hemmelighet), expiresAt: utloper })
        .onConflictDoNothing()
        .returning({ code: boardPairings.code });
      if (rader.length > 0) return { kode, hemmelighet, utloper: utloper.toISOString() };
    }
    throw new ApiFeil(503, "Kunne ikke lage en koblingskode. Prøv igjen.");
  });
}

/**
 * Skjermen spør om koden er tatt i bruk. Når den er det, får skjermen et ferskt token — én
 * gang: koblingsraden slettes i samme transaksjon, så hemmeligheten kan ikke brukes igjen.
 */
export async function sjekkKobling(
  hemmelighet: string,
): Promise<{ status: "venter" } | { status: "utlopt" } | { status: "koblet"; token: string }> {
  return withoutRls("skjerm", (db) =>
    db.transaction(async (tx) => {
      const [kobling] = await tx
        .select()
        .from(boardPairings)
        .where(eq(boardPairings.secretHash, hash(hemmelighet)))
        .limit(1);
      if (!kobling) return { status: "utlopt" as const };
      if (!kobling.screenId) {
        return kobling.expiresAt < new Date() ? { status: "utlopt" as const } : { status: "venter" as const };
      }
      const token = randomBytes(32).toString("base64url");
      await tx
        .update(boardScreens)
        .set({ deviceTokenHash: hash(token), lastSeenAt: new Date() })
        .where(eq(boardScreens.id, kobling.screenId));
      await tx.delete(boardPairings).where(eq(boardPairings.code, kobling.code));
      return { status: "koblet" as const, token };
    }),
  );
}

/** `Authorization: Bearer <token>` → skjermen. 401 hvis skjermen er fjernet i appen. */
async function skjermFraToken(req: Request): Promise<{ id: string; orgId: string }> {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new ApiFeil(401, "Skjermen er ikke koblet til");
  // Det ENE oppslaget uten org-kontekst: tokenet → skjerm og org. Alt etter dette går
  // gjennom `withOrg`. Livstegnet skrives her også — hver henting er et livstegn.
  const [skjerm] = await withoutRls("skjerm", (db) =>
    db
      .update(boardScreens)
      .set({ lastSeenAt: new Date() })
      .where(eq(boardScreens.deviceTokenHash, hash(token)))
      .returning({ id: boardScreens.id, orgId: boardScreens.orgId }),
  );
  if (!skjerm) throw new ApiFeil(401, "Skjermen er ikke koblet til");
  return skjerm;
}

export async function innholdForSkjerm(req: Request): Promise<Skjerminnhold> {
  const s = await skjermFraToken(req);
  return withOrg(s.orgId, (db) => byggSkjerminnhold(db, s.orgId, s.id));
}

/**
 * Et bilde til skjermen. Skjermen får bare bilder fra oppslag den selv skal vise — et
 * token for oppgang A gir ikke tilgang til bildene som bare gjelder oppgang B.
 */
export async function filForSkjerm(req: Request, postId: string): Promise<Filsvar> {
  const s = await skjermFraToken(req);
  return withOrg(s.orgId, async (db) => {
    const innhold = await byggSkjerminnhold(db, s.orgId, s.id);
    if (!innhold.oppslag.some((p) => p.id === postId && p.harFil)) throw ikkeFunnet("Bilde");
    return hentOppslagFil(db, s.orgId, postId);
  });
}

/** Kontaktbildet — bare fra skjermens eget borettslag (`enKontakt` filtrerer på org). */
export async function kontaktbildeForSkjerm(req: Request, kontaktId: string): Promise<Filsvar> {
  const s = await skjermFraToken(req);
  return withOrg(s.orgId, (db) => hentKontaktbilde(db, s.orgId, kontaktId));
}

export async function logoForSkjerm(req: Request): Promise<Filsvar> {
  const s = await skjermFraToken(req);
  return withOrg(s.orgId, (db) => hentLogo(db, s.orgId));
}
