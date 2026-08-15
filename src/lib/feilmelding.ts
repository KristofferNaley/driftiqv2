/**
 * «Meld feil» — innmeldinger fra kunde-appen. Port av v1s `routers/feedback.py`.
 *
 * ## Saken hører til DriftIQ, ikke til kunden
 *
 * Løpenummeret går på tvers av alle kunder (FM-0042) fordi det er VÅR sakskø. Kunden ser
 * bare sine egne, og det håndheves i API-gaten — tabellen står i `UNNTATT` og har ingen
 * RLS-policy, siden en sak må kunne leses av plattformadmin uten org-kontekst.
 *
 * ## Tre typer, ett skjema
 *
 * Feil, forslag og spørsmål i samme inngang. Et styremedlem som opplever at noe ikke virker
 * skiller ikke mellom «bug» og «det jeg trodde skulle skje» — å tvinge fram et valg gir
 * feilsorterte saker og færre innmeldinger.
 */

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "../db/client";
import { feedbackMessages, feedbackReports } from "../db/schema/feedback";
import { organizations } from "../db/schema/organizations";
import { ikkeFunnet } from "./api";
import { STATUS_ETIKETT, TYPER } from "./feilmeldingtyper";

// Etikettene bor i en ren fil uten server-importer — se kommentaren der.
export { STATUS_ETIKETT, TYPER, TYPE_ETIKETT } from "./feilmeldingtyper";

export const feilmeldingInn = z.object({
  kind: z.enum(TYPER).default("bug"),
  /** Modulnøkkel, eller null = vet ikke. Å kreve et valg gir gjetting. */
  module: z.string().trim().nullish(),
  description: z.string().trim().min(5, "Beskriv gjerne litt mer, så slipper vi en runde til"),
  appVersion: z.string().trim().max(40).nullish(),
  /** Siden melderen sto på og vindusstørrelsen — legges ved av skjemaet, ikke skrevet inn. */
  url: z.string().trim().max(300).nullish(),
  screen: z.string().trim().max(40).nullish(),
});

export const svarInn = z.object({
  body: z.string().trim().min(1, "Svaret kan ikke være tomt"),
  /** Interne notater sendes ikke til kunden. */
  internal: z.boolean().default(false),
});

/** Neste saksnummer. På tvers av kunder — det er DriftIQs kø. */
async function nesteNummer(db: Db): Promise<number> {
  const rader = await db
    .select({ maks: sql<number | null>`max(${feedbackReports.number})` })
    .from(feedbackReports);
  return (rader[0]?.maks ?? 0) + 1;
}

export async function meldFeil(
  db: Db,
  orgId: string,
  melder: { id: string; name: string; email: string },
  data: z.infer<typeof feilmeldingInn>,
  userAgent: string | null,
) {
  const [rad] = await db
    .insert(feedbackReports)
    .values({
      id: randomUUID(),
      number: await nesteNummer(db),
      orgId,
      kind: data.kind,
      module: data.module ?? null,
      description: data.description,
      // Navn og e-post KOPIERES inn: en sak skal kunne besvares selv om personen er fjernet
      // fra borettslaget i mellomtiden.
      reportedByUserId: melder.id,
      reportedByName: melder.name,
      reportedByEmail: melder.email,
      appVersion: data.appVersion ?? null,
      // Nettleser og versjon legges ved automatisk, så vi slipper å spørre etterpå.
      userAgent: userAgent?.slice(0, 500) ?? null,
      url: data.url ?? null,
      screen: data.screen ?? null,
    })
    .returning();
  return rad!;
}

/** Kundens egne saker. Brukes av appen, som bare skal se sine. */
export async function hentEgneSaker(db: Db, orgId: string) {
  return db
    .select()
    .from(feedbackReports)
    .where(eq(feedbackReports.orgId, orgId))
    .orderBy(desc(feedbackReports.createdAt))
    .limit(50);
}

/**
 * Alle saker på tvers av kunder, med tidspunktet for FØRSTE svar til melderen per sak.
 * «Ubesvart» og svartiden i KPI-ene regnes av panelet fra det ene feltet — interne notater
 * teller ikke: et notat til seg selv er ikke et svar kunden har fått.
 */
export async function hentAlleSaker(db: Db) {
  const rader = await db
    .select({
      id: feedbackReports.id,
      nummer: feedbackReports.number,
      orgId: feedbackReports.orgId,
      orgNavn: organizations.name,
      type: feedbackReports.kind,
      modul: feedbackReports.module,
      beskrivelse: feedbackReports.description,
      status: feedbackReports.status,
      melderNavn: feedbackReports.reportedByName,
      melderEpost: feedbackReports.reportedByEmail,
      appVersjon: feedbackReports.appVersion,
      nettleser: feedbackReports.userAgent,
      side: feedbackReports.url,
      skjerm: feedbackReports.screen,
      iBacklog: feedbackReports.inBacklog,
      opprettet: feedbackReports.createdAt,
    })
    .from(feedbackReports)
    .innerJoin(organizations, eq(organizations.id, feedbackReports.orgId))
    .orderBy(desc(feedbackReports.createdAt))
    .limit(200);
  if (rader.length === 0) return [];

  const svar = await db
    .select({ reportId: feedbackMessages.reportId, sendt: feedbackMessages.createdAt })
    .from(feedbackMessages)
    .where(
      and(
        inArray(
          feedbackMessages.reportId,
          rader.map((r) => r.id),
        ),
        eq(feedbackMessages.internal, false),
      ),
    );
  const forste = new Map<string, Date>();
  for (const s of svar) {
    const har = forste.get(s.reportId);
    if (!har || s.sendt < har) forste.set(s.reportId, s.sendt);
  }
  return rader.map((r) => ({ ...r, forsteSvar: forste.get(r.id) ?? null }));
}

export async function hentSak(db: Db, sakId: string) {
  const rader = await db
    .select()
    .from(feedbackReports)
    .where(eq(feedbackReports.id, sakId))
    .limit(1);
  const sak = rader[0];
  if (!sak) throw ikkeFunnet("Sak");

  const meldinger = await db
    .select()
    .from(feedbackMessages)
    .where(eq(feedbackMessages.reportId, sakId))
    .orderBy(feedbackMessages.createdAt);

  return { ...sak, meldinger };
}

export const statusInn = z.object({
  status: z.enum(["ny", "under_arbeid", "venter_kunde", "lost"]),
});

export async function settStatus(db: Db, sakId: string, status: string, av: string) {
  const [gammel] = await db
    .select({ status: feedbackReports.status })
    .from(feedbackReports)
    .where(eq(feedbackReports.id, sakId))
    .limit(1);
  if (!gammel) throw ikkeFunnet("Sak");

  const [rad] = await db
    .update(feedbackReports)
    .set({
      status,
      // Løses saken, føres når og av hvem. Åpnes den igjen, nullstilles begge — ellers ville
      // en gjenåpnet sak sett ut som løst i alle rapporter.
      resolvedAt: status === "lost" ? new Date() : null,
      resolvedBy: status === "lost" ? av : null,
    })
    .where(eq(feedbackReports.id, sakId))
    .returning();

  // Endringen føres som internt trådinnlegg — samme grep som leads-loggen: historikken
  // skrives av serveren, ikke av at noen husket å notere. Uendret status logges ikke.
  if (gammel.status !== status) {
    await db.insert(feedbackMessages).values({
      id: randomUUID(),
      reportId: sakId,
      internal: true,
      authorName: av,
      body: `Status satt til ${STATUS_ETIKETT[status] ?? status}`,
    });
  }

  return { sak: rad!, bleLost: status === "lost" && gammel.status !== "lost" };
}

export async function svarPaSak(
  db: Db,
  sakId: string,
  forfatter: string,
  data: z.infer<typeof svarInn>,
) {
  const [sak] = await db
    .select({ id: feedbackReports.id, status: feedbackReports.status })
    .from(feedbackReports)
    .where(eq(feedbackReports.id, sakId))
    .limit(1);
  if (!sak) throw ikkeFunnet("Sak");

  const [rad] = await db
    .insert(feedbackMessages)
    .values({
      id: randomUUID(),
      reportId: sakId,
      internal: data.internal,
      authorName: forfatter,
      body: data.body,
    })
    .returning();

  // Et svar til melderen på en urørt sak ER å begynne på den — statusen følger med, så
  // «Ny»-lista forblir lista over saker ingen har rørt. Interne notater flytter ingenting.
  if (!data.internal && sak.status === "ny") {
    await db
      .update(feedbackReports)
      .set({ status: "under_arbeid" })
      .where(eq(feedbackReports.id, sakId));
  }

  return rad!;
}

/** Backlog-bryteren: «dette skal vi gjøre noe med». Føres videre manuelt, som i v1. */
export async function settBacklog(db: Db, sakId: string, iBacklog: boolean) {
  const [rad] = await db
    .update(feedbackReports)
    .set({ inBacklog: iBacklog })
    .where(eq(feedbackReports.id, sakId))
    .returning();
  if (!rad) throw ikkeFunnet("Sak");
  return rad;
}

/** Antall saker som ikke er lukket. Til merket i panelmenyen. */
export async function antallApne(db: Db): Promise<number> {
  const rader = await db
    .select({ n: sql<string>`count(*)` })
    .from(feedbackReports)
    .where(and(sql`${feedbackReports.status} <> 'lost'`));
  return Number(rader[0]?.n ?? 0);
}
