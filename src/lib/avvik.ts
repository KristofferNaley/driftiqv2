/**
 * Avvik — port av v1s `routers/deviations.py`.
 *
 * ## Tre statuser, én vei ut
 *
 * `ny` → `under_behandling` → `lukket`. Lukking skjer KUN via `lukkAvvik()`, aldri ved å
 * sette status direkte: lukkingen krever en løsningsbeskrivelse, og det kravet ville vært
 * trivielt å omgå hvis status var et vanlig felt. Et lukket avvik kan heller ikke endres.
 *
 * ## Ikke portert ennå
 *
 * - Vedlegg (`deviation_attachments`) — venter på fillagring.
 */

import { and, asc, count, desc, eq, ilike, isNotNull, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "../db/client";
import { deviationAttachments, deviationLogs, deviationTreatments, deviations } from "../db/schema/avvik";
import { tasks } from "../db/schema/tasks";
import { units } from "../db/schema/units";
import { userOrgMemberships, users } from "../db/schema/users";
import { vendors } from "../db/schema/vendors";
import { ikkeFunnet, ugyldig } from "./api";
import { lagreFil } from "./lagring";
import { organizations } from "../db/schema/organizations";
import type { Aktor } from "./aktor";

export const STATUSER = ["ny", "under_behandling", "lukket"] as const;
export const ALVORLIGHET = ["lav", "middels", "akutt"] as const;

/** Statusene en bruker kan sette direkte. `lukket` er bevisst utenfor. */
export const APNE_STATUSER = ["ny", "under_behandling"] as const;

export const avvikInn = z.object({
  title: z.string().trim().min(1, "Tittel må fylles ut"),
  description: z.string().nullish(),
  category: z.string().trim().nullish(),
  severity: z.enum(ALVORLIGHET).nullish(),
  taskId: z.string().nullish(),
  vendorId: z.string().nullish(),
  unitId: z.string().nullish(),
  roundId: z.string().nullish(),
  roundItemId: z.string().nullish(),
  responsibleUserId: z.string().nullish(),
  dueDate: z.string().date().nullish(),
});

export const avvikEndring = avvikInn.partial().extend({
  status: z.enum(APNE_STATUSER).optional(),
});

export const lukkInn = z.object({
  resolutionNotes: z.string().trim().min(1, "Avviket kan ikke lukkes uten en løsningsbeskrivelse."),
});

export const behandlingInn = z.object({
  text: z.string().trim().min(1, "Innlegget kan ikke være tomt"),
});

async function skrivLogg(db: Db, deviationId: string, av: Aktor, hendelse: string) {
  await db.insert(deviationLogs).values({
    id: randomUUID(),
    deviationId,
    changedBy: av.navn,
    changedByUserId: av.brukerId,
    event: hendelse,
  });
}

/** Fremmednøkler må peke inn i SAMME org. Ansvarlig må i tillegg være MEDLEM av org-en. */
async function validerKoblinger(
  db: Db,
  orgId: string,
  f: { vendorId?: string | null; unitId?: string | null; responsibleUserId?: string | null },
) {
  if (f.vendorId) {
    const r = await db.select({ id: vendors.id }).from(vendors)
      .where(and(eq(vendors.id, f.vendorId), eq(vendors.orgId, orgId))).limit(1);
    if (r.length === 0) throw ikkeFunnet("Leverandør");
  }
  if (f.unitId) {
    const r = await db.select({ id: units.id }).from(units)
      .where(and(eq(units.id, f.unitId), eq(units.orgId, orgId))).limit(1);
    if (r.length === 0) throw ikkeFunnet("Enhet");
  }
  if (f.responsibleUserId) {
    // Ikke bare «finnes brukeren», men «er de medlem her». Uten dette kunne et avvik
    // tildeles noen i et annet borettslag, og de ville sett det i «mine avvik».
    const r = await db.select({ id: userOrgMemberships.id }).from(userOrgMemberships)
      .where(and(
        eq(userOrgMemberships.userId, f.responsibleUserId),
        eq(userOrgMemberships.orgId, orgId),
      )).limit(1);
    if (r.length === 0) throw ugyldig("Ansvarlig må være medlem av organisasjonen.");
  }
}

/** Ansvarliges NÅVÆRENDE navn vinner over det lagrede — et navnebytte skal ikke vises feil. */
function medAnsvarlig<T extends { assignedTo: string | null }>(rad: T, brukernavn: string | null) {
  return { ...rad, assignedTo: brukernavn ?? rad.assignedTo };
}

/**
 * Egne alias for brukertabellen per rolle på avviket.
 *
 * `users` er allerede med i spørringen for ANSVARLIG. Skal melderen og den som lukket saken
 * også slås opp, må hver av dem ha sin egen instans av tabellen — ellers blir det én join som
 * må stemme for tre ulike id-er, og resultatet er rader som forsvinner.
 */
const melderBruker = alias(users, "melder_bruker");
const lukkerBruker = alias(users, "lukker_bruker");
const forfatterBruker = alias(users, "forfatter_bruker");

/**
 * Aktørnavnet slik det skal VISES: personens nåværende navn når raden har en id, ellers
 * navnet som ble kopiert inn da raden ble skrevet.
 *
 * Samme regel som `medAnsvarlig` har hatt hele tiden, nå brukt på melder, lukker og
 * behandlingsforfatter. Poenget er at et navnebytte ikke skal gi feil visning — snapshotet i
 * kolonnen er reserven for rader uten id (QR-anonym, leverandørportal, slettet konto), ikke
 * fasiten når vi vet bedre.
 */
const visNavn = (naa: string | null, lagret: string) => naa ?? lagret;

/**
 * Kolonnene som kan sorteres på, og hva de faktisk sorterer.
 *
 * **Hviteliste, ikke en streng fra klienten.** Sorteringsfeltet kommer fra en URL-parameter;
 * slippes den rett inn i `ORDER BY`, er det en SQL-injeksjon. Her kan en ukjent verdi bare
 * falle tilbake til standarden.
 */
const SORTERBARE = {
  number: deviations.number,
  title: deviations.title,
  reported_at: deviations.reportedAt,
  due_date: deviations.dueDate,
  reported_by: deviations.reportedBy,
  assigned_to: deviations.assignedTo,
  category: deviations.category,
  status: deviations.status,
} as const;

export type Sorterbar = keyof typeof SORTERBARE;

export const SIDESTORRELSE = 25;

export const avvikSok = z.object({
  side: z.coerce.number().int().min(1).default(1),
  sok: z.string().trim().default(""),
  kategori: z.string().trim().default(""),
  unitId: z.string().trim().default(""),
  /**
   * IKKE `z.coerce.boolean()`. Den kjører `Boolean(verdi)`, og for en URL-parameter er
   * verdien alltid en streng — `"false"` er en ikke-tom streng og blir dermed `true`.
   * Symptomet var at «Aktive» viste de lukkede avvikene.
   */
  lukkede: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .default(false)
    .transform((v) => v === true || v === "true"),
  sorter: z.string().default("reported_at"),
  retning: z.enum(["asc", "desc"]).default("desc"),
});

/**
 * Avvikslista — filtrert, sortert og paginert.
 *
 * Paginering er ikke pynt: v1 hentet ALLE avvik og filtrerte i nettleseren fram til lista
 * ble lang nok til at det merket. Et lag med noen års drift har fort tusen rader, og de skal
 * ikke over ledningen for å vise 25.
 */
export async function hentAvvik(
  db: Db,
  orgId: string,
  opts: Partial<z.infer<typeof avvikSok>> & { lukkede?: boolean } = {},
) {
  const {
    side = 1,
    sok = "",
    kategori = "",
    unitId = "",
    lukkede,
    sorter = "reported_at",
    retning = "desc",
  } = opts;

  const betingelser = [eq(deviations.orgId, orgId)];
  if (lukkede === true) betingelser.push(eq(deviations.status, "lukket"));
  if (lukkede === false) betingelser.push(sql`${deviations.status} <> 'lukket'`);
  if (kategori) betingelser.push(eq(deviations.category, kategori));
  if (unitId) betingelser.push(eq(deviations.unitId, unitId));

  if (sok) {
    // Søk på «#21» eller «21» skal treffe løpenummeret, ikke lete etter tallet i tittelen.
    const somTall = Number(sok.replace(/^#/, ""));
    const tittelTreff = ilike(deviations.title, `%${sok}%`);
    betingelser.push(
      Number.isInteger(somTall) && somTall > 0
        ? or(tittelTreff, eq(deviations.number, somTall))!
        : tittelTreff,
    );
  }

  const hvor = and(...betingelser);
  const kolonne = SORTERBARE[sorter as Sorterbar] ?? deviations.reportedAt;

  const [rader, antall] = await Promise.all([
    db
      .select({
        avvik: deviations,
        brukernavn: users.name,
        melderNavn: melderBruker.name,
        unitNavn: units.navn,
      })
      .from(deviations)
      .leftJoin(users, eq(users.id, deviations.responsibleUserId))
      .leftJoin(melderBruker, eq(melderBruker.id, deviations.reportedByUserId))
      .leftJoin(units, eq(units.id, deviations.unitId))
      .where(hvor)
      // Løpenummeret som andrenøkkel: uten det kan to rader med samme dato bytte plass
      // mellom to sidelastinger, og da hopper rader mellom sider under paginering.
      .orderBy(retning === "desc" ? desc(kolonne) : asc(kolonne), desc(deviations.number))
      .limit(SIDESTORRELSE)
      .offset((side - 1) * SIDESTORRELSE),
    db.select({ n: count() }).from(deviations).where(hvor),
  ]);

  const total = antall[0]?.n ?? 0;
  return {
    items: rader.map((r) => ({
      ...medAnsvarlig(r.avvik, r.brukernavn),
      reportedBy: visNavn(r.melderNavn, r.avvik.reportedBy),
      unitNavn: r.unitNavn,
    })),
    total,
    side,
    sider: Math.max(1, Math.ceil(total / SIDESTORRELSE)),
  };
}

/**
 * Nøkkeltallene over lista.
 *
 * `ytd` teller inneværende år til dags dato og sammenlignes med SAMME periode i fjor — ikke
 * med hele fjoråret. Sammenligner man mot et helt år, ser man alltid ut til å ha færre avvik
 * i januar, og tallet sier ingenting.
 */
export async function avvikStatistikk(db: Db, orgId: string, brukerId: string) {
  const naa = new Date();
  const iAar = naa.getUTCFullYear();
  const startIAar = new Date(Date.UTC(iAar, 0, 1));
  const startIFjor = new Date(Date.UTC(iAar - 1, 0, 1));
  // Samme dag og klokkeslett, ett år tilbake — grensen for «hittil i fjor».
  const naaIFjor = new Date(naa);
  naaIFjor.setUTCFullYear(iAar - 1);

  const [ytdRad, ifjorRad, perStatus, mineRad] = await Promise.all([
    db
      .select({ n: count() })
      .from(deviations)
      .where(and(eq(deviations.orgId, orgId), sql`${deviations.reportedAt} >= ${startIAar}`)),
    db
      .select({ n: count() })
      .from(deviations)
      .where(
        and(
          eq(deviations.orgId, orgId),
          sql`${deviations.reportedAt} >= ${startIFjor}`,
          sql`${deviations.reportedAt} < ${naaIFjor}`,
        ),
      ),
    db
      .select({ status: deviations.status, n: count() })
      .from(deviations)
      .where(eq(deviations.orgId, orgId))
      .groupBy(deviations.status),
    db
      .select({ n: count() })
      .from(deviations)
      .where(
        and(
          eq(deviations.orgId, orgId),
          eq(deviations.responsibleUserId, brukerId),
          sql`${deviations.status} <> 'lukket'`,
        ),
      ),
  ]);

  const ytd = ytdRad[0]?.n ?? 0;
  const ytdIFjor = ifjorRad[0]?.n ?? 0;
  const tell = (s: string) => perStatus.find((r) => r.status === s)?.n ?? 0;

  return {
    ytd,
    ytdIFjor,
    // `null` når i fjor var null — «uendelig prosent opp» er ikke et tall å vise noen.
    ytdEndring: ytdIFjor === 0 ? null : Math.round(((ytd - ytdIFjor) / ytdIFjor) * 100),
    ny: tell("ny"),
    underBehandling: tell("under_behandling"),
    lukket: tell("lukket"),
    mine: mineRad[0]?.n ?? 0,
  };
}

/** Kundens avvikskategorier, eller standardsettet. */
export async function hentKategorier(db: Db, orgId: string): Promise<string | null> {
  const rader = await db
    .select({ k: organizations.deviationCategories })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  return rader[0]?.k ?? null;
}

export async function hentEttAvvik(db: Db, orgId: string, devId: string) {
  // Navnene, ikke bare id-ene: detaljsiden skal kunne vise «Heis-Service Bergen» uten et
  // ekstra rundtur-kall per felt. Samme joins som lista, med oppgaven i tillegg.
  const rader = await db
    .select({
      avvik: deviations,
      brukernavn: users.name,
      melderNavn: melderBruker.name,
      lukkerNavn: lukkerBruker.name,
      unitNavn: units.navn,
      vendorNavn: vendors.name,
      taskTittel: tasks.title,
    })
    .from(deviations)
    .leftJoin(users, eq(users.id, deviations.responsibleUserId))
    .leftJoin(melderBruker, eq(melderBruker.id, deviations.reportedByUserId))
    .leftJoin(lukkerBruker, eq(lukkerBruker.id, deviations.resolvedByUserId))
    .leftJoin(units, eq(units.id, deviations.unitId))
    .leftJoin(vendors, eq(vendors.id, deviations.vendorId))
    .leftJoin(tasks, eq(tasks.id, deviations.taskId))
    .where(and(eq(deviations.id, devId), eq(deviations.orgId, orgId)))
    .limit(1);
  const rad = rader[0];
  if (!rad) throw ikkeFunnet("Avvik");

  const [behandlinger, logg, vedlegg] = await Promise.all([
    db
      .select({ b: deviationTreatments, forfatterNavn: forfatterBruker.name })
      .from(deviationTreatments)
      .leftJoin(forfatterBruker, eq(forfatterBruker.id, deviationTreatments.createdByUserId))
      .where(eq(deviationTreatments.deviationId, devId))
      .orderBy(asc(deviationTreatments.createdAt))
      .then((rader) =>
        rader.map((r) => ({ ...r.b, createdBy: visNavn(r.forfatterNavn, r.b.createdBy) })),
      ),
    db.select().from(deviationLogs)
      .where(eq(deviationLogs.deviationId, devId))
      .orderBy(asc(deviationLogs.changedAt)),
    db.select().from(deviationAttachments)
      .where(eq(deviationAttachments.deviationId, devId))
      .orderBy(asc(deviationAttachments.uploadedAt)),
  ]);

  return {
    ...medAnsvarlig(rad.avvik, rad.brukernavn),
    reportedBy: visNavn(rad.melderNavn, rad.avvik.reportedBy),
    resolvedBy: rad.lukkerNavn ?? rad.avvik.resolvedBy,
    unitNavn: rad.unitNavn,
    vendorNavn: rad.vendorNavn,
    taskTittel: rad.taskTittel,
    behandlinger,
    logg,
    vedlegg,
  };
}

/* ── Vedlegg ─────────────────────────────────────────────────────────────────────────── */

/**
 * Laster opp et vedlegg til et avvik.
 *
 * `treatmentId` knytter filen til ET behandlingsinnlegg — da vises den på innlegget, ikke
 * bare i lista. En rapport lastet opp sammen med en behandling mister ellers sammenhengen
 * den ble skrevet i.
 *
 * Et LUKKET avvik tar ikke imot nye vedlegg. Dokumentasjonskjeden er avsluttet, og å kunne
 * legge til bevis i ettertid ville undergravd at den er troverdig.
 */
export async function lastOppVedlegg(
  db: Db,
  orgId: string,
  devId: string,
  lastetAv: Aktor,
  fil: File,
  treatmentId?: string | null,
) {
  const avvik = await db
    .select({ status: deviations.status })
    .from(deviations)
    .where(and(eq(deviations.id, devId), eq(deviations.orgId, orgId)))
    .limit(1);
  if (!avvik[0]) throw ikkeFunnet("Avvik");
  if (avvik[0].status === "lukket") {
    throw ugyldig("Avviket er lukket. Vedlegg kan ikke legges til i ettertid.");
  }

  const lagret = await lagreFil(db, orgId, "deviations", fil);
  const [rad] = await db
    .insert(deviationAttachments)
    .values({
      id: randomUUID(),
      deviationId: devId,
      orgId,
      treatmentId: treatmentId ?? null,
      filename: lagret.filnavn,
      originalName: lagret.originalnavn,
      contentType: lagret.contentType,
      fileSize: lagret.storrelse,
      uploadedBy: lastetAv.navn,
      uploadedByUserId: lastetAv.brukerId,
    })
    .returning();

  await skrivLogg(db, devId, lastetAv, `La ved «${lagret.originalnavn}»`);
  return rad!;
}

/**
 * Sletter et vedlegg.
 *
 * Fila blir liggende på disk. Det er med vilje: sletting fra basen er reversibelt, sletting
 * fra disk er det ikke, og en feilklikket sletting av dokumentasjon på et avvik er dyr.
 * Opprydding av foreldreløse filer hører til en egen jobb, ikke til et klikk i UI-et.
 */
export async function slettVedlegg(db: Db, orgId: string, devId: string, vedleggId: string, av: Aktor) {
  const rader = await db
    .select({ navn: deviationAttachments.originalName })
    .from(deviationAttachments)
    .where(
      and(
        eq(deviationAttachments.id, vedleggId),
        eq(deviationAttachments.deviationId, devId),
        eq(deviationAttachments.orgId, orgId),
      ),
    )
    .limit(1);
  const vedlegg = rader[0];
  if (!vedlegg) throw ikkeFunnet("Vedlegg");

  await db.delete(deviationAttachments).where(eq(deviationAttachments.id, vedleggId));
  await skrivLogg(db, devId, av, `Fjernet vedlegget «${vedlegg.navn}»`);
}

/** Neste løpenummer i org-en. Tildeles ved opprettelse og endres aldri. */
async function nesteNummer(db: Db, orgId: string): Promise<number> {
  const rader = await db
    .select({ maks: sql<number | null>`max(${deviations.number})` })
    .from(deviations)
    .where(eq(deviations.orgId, orgId));
  return (rader[0]?.maks ?? 0) + 1;
}

export async function opprettAvvik(
  db: Db,
  orgId: string,
  melder: Aktor,
  data: z.infer<typeof avvikInn>,
) {
  await validerKoblinger(db, orgId, data);

  const navn = data.responsibleUserId
    ? (await db.select({ name: users.name }).from(users).where(eq(users.id, data.responsibleUserId)).limit(1))[0]?.name
    : null;

  const [ny] = await db
    .insert(deviations)
    .values({
      id: randomUUID(),
      orgId,
      number: await nesteNummer(db, orgId),
      reportedBy: melder.navn,
      reportedByUserId: melder.brukerId,
      assignedTo: navn ?? null,
      ...data,
    })
    .returning();

  await skrivLogg(db, ny!.id, melder, `Avvik meldt av ${melder.navn}`);
  return ny!;
}

export async function endreAvvik(
  db: Db,
  orgId: string,
  devId: string,
  endretAv: Aktor,
  data: z.infer<typeof avvikEndring>,
) {
  const avvik = await hentEttAvvik(db, orgId, devId);
  /**
   * Et lukket avvik er dokumentasjon og kan ikke endres — MED UNNTAK av merkelappene:
   * kategori, alvorlighet og sted er statistikk-koblinger, ikke del av den låste
   * historikken. Uten unntaket ville statistikken arvet en hastig førstekategorisering
   * for alltid, og gamle avvik kunne aldri fått enheten sin i etterkant. Endringene
   * føres i historikken, så unntaket er sporbart.
   */
  const MERKELAPPFELT = new Set(["category", "severity", "unitId"]);
  if (avvik.status === "lukket" && Object.keys(data).some((k) => !MERKELAPPFELT.has(k))) {
    throw ugyldig("Avviket er lukket — bare kategori, alvorlighet og sted kan endres i etterkant.");
  }
  await validerKoblinger(db, orgId, data);

  const patch: Record<string, unknown> = { ...data };
  if (data.responsibleUserId !== undefined) {
    // Feltene holdes i takt ved skriving — se kommentaren på `deviations.assignedTo`.
    patch.assignedTo = data.responsibleUserId
      ? (await db.select({ name: users.name }).from(users).where(eq(users.id, data.responsibleUserId)).limit(1))[0]?.name ?? null
      : null;
  }

  const [endret] = await db
    .update(deviations)
    .set(patch)
    .where(and(eq(deviations.id, devId), eq(deviations.orgId, orgId)))
    .returning();

  if (data.status && data.status !== avvik.status) {
    await skrivLogg(db, devId, endretAv, `Status endret til ${data.status} av ${endretAv.navn}`);
  }
  // Merkelappene logges — de kan endres også ETTER lukking, og da er sporet alt man har.
  if (data.category !== undefined && (data.category ?? null) !== avvik.category) {
    await skrivLogg(db, devId, endretAv,
      data.category ? `Kategori endret til «${data.category}» av ${endretAv.navn}` : `Kategori fjernet av ${endretAv.navn}`);
  }
  if (data.severity !== undefined && (data.severity ?? null) !== avvik.severity) {
    await skrivLogg(db, devId, endretAv,
      data.severity ? `Alvorlighet satt til ${data.severity} av ${endretAv.navn}` : `Alvorlighet fjernet av ${endretAv.navn}`);
  }
  if (data.unitId !== undefined && (data.unitId ?? null) !== avvik.unitId) {
    const enhet = data.unitId
      ? (await db.select({ navn: units.navn, leilighetsnr: units.leilighetsnr, andelsnr: units.andelsnr })
          .from(units).where(eq(units.id, data.unitId)).limit(1))[0]
      : null;
    const stedNavn = enhet ? (enhet.navn ?? enhet.leilighetsnr ?? `andel ${enhet.andelsnr ?? "?"}`) : null;
    await skrivLogg(db, devId, endretAv,
      stedNavn ? `Sted satt til «${stedNavn}» av ${endretAv.navn}` : `Sted fjernet av ${endretAv.navn}`);
  }
  return endret!;
}

/**
 * Lukker avviket. Eneste vei til status `lukket`.
 *
 * Løsningsbeskrivelsen er påkrevd av Zod-skjemaet: den er siste ledd i dokumentasjonskjeden
 * som havner i internkontrollpermen, og et avvik lukket med tom begrunnelse dokumenterer
 * ingenting.
 */
export async function lukkAvvik(
  db: Db,
  orgId: string,
  devId: string,
  /**
   * Den som utfører lukkingen — altså den innloggede, og det er DET navnet protokollen
   * får. v1 lot brukeren skrive et fritt «lukket av»-navn (for lukking på vegne av en
   * leverandør), men et felt man fyller ut selv er også et felt man kan skrive feil i —
   * og «hvem lukket» skal være et faktum, ikke en påstand. Lukkes det på vegne av noen,
   * hører det hjemme i løsningsbeskrivelsen.
   */
  utfortAv: Aktor,
  data: z.infer<typeof lukkInn>,
) {
  const avvik = await hentEttAvvik(db, orgId, devId);
  if (avvik.status === "lukket") throw ugyldig("Avviket er allerede lukket.");

  const [lukket] = await db
    .update(deviations)
    .set({
      status: "lukket",
      resolvedAt: sql`now()`,
      resolvedBy: utfortAv.navn,
      resolvedByUserId: utfortAv.brukerId,
      resolutionNotes: data.resolutionNotes,
    })
    .where(and(eq(deviations.id, devId), eq(deviations.orgId, orgId)))
    .returning();

  await skrivLogg(
    db,
    devId,
    utfortAv,
    `Avvik lukket av ${utfortAv.navn}. Løsning: ${data.resolutionNotes}`,
  );
  return lukket!;
}

/** Legger et innlegg i behandlingsjournalen. Append-only — se kommentaren på tabellen. */
export async function leggTilBehandling(
  db: Db,
  orgId: string,
  devId: string,
  forfatter: Aktor,
  data: z.infer<typeof behandlingInn>,
) {
  const avvik = await hentEttAvvik(db, orgId, devId);
  if (avvik.status === "lukket") {
    throw ugyldig("Avviket er lukket — behandlingen kan ikke fortsette.");
  }

  const [ny] = await db
    .insert(deviationTreatments)
    .values({
      id: randomUUID(),
      deviationId: devId,
      text: data.text,
      createdBy: forfatter.navn,
      createdByUserId: forfatter.brukerId,
    })
    .returning();

  // Første behandlingsinnlegg flytter avviket fra «ny» til «under behandling» av seg selv.
  // Å kreve at brukeren gjør begge deler manuelt gir bare statuser som ligger og henger.
  if (avvik.status === "ny") {
    await db.update(deviations).set({ status: "under_behandling" })
      .where(and(eq(deviations.id, devId), eq(deviations.orgId, orgId)));
    await skrivLogg(db, devId, forfatter, `Behandling startet av ${forfatter}`);
  }
  return ny!;
}

/** Antall per status — grunnlaget for KPI-ene på dashbordet. */
export async function tellPerStatus(db: Db, orgId: string) {
  const rader = await db
    .select({ status: deviations.status, antall: sql<number>`count(*)::int` })
    .from(deviations)
    .where(eq(deviations.orgId, orgId))
    .groupBy(deviations.status);
  return Object.fromEntries(rader.map((r) => [r.status, r.antall]));
}

/**
 * Avvik per enhet — totalt og åpne, i én grupperende spørring. Totalen er historikken som
 * gjør registeret verdt å ha (gjentakende fukt i samme leilighet over år), de åpne er det
 * som trenger noen nå.
 */
export async function avvikPerEnhet(
  db: Db,
  orgId: string,
): Promise<Map<string, { totalt: number; apne: number }>> {
  const rader = await db
    .select({
      unitId: deviations.unitId,
      totalt: sql<number>`count(*)::int`,
      apne: sql<number>`count(*) filter (where ${deviations.status} <> 'lukket')::int`,
    })
    .from(deviations)
    .where(and(eq(deviations.orgId, orgId), isNotNull(deviations.unitId)))
    .groupBy(deviations.unitId);
  return new Map(rader.map((r) => [r.unitId!, { totalt: r.totalt, apne: r.apne }]));
}
