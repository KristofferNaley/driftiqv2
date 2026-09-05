/**
 * Verktøyene AI-rådgiveren kan kalle for å hente kundens egne data.
 *
 * # SIKKERHET — les dette før du legger til et verktøy
 *
 * **`orgId` kommer ALDRI fra modellen.** Den bindes i rutelaget fra den innloggede brukerens
 * verifiserte org-tilgang og sendes inn som første argument til `kjorVerktoy()`.
 * Verktøyskjemaene under eksponerer derfor ingen org-parameter — hadde de gjort det, kunne en
 * promptinjeksjon i et avviksnotat eller et kontraktvedlegg fått modellen til å be om en
 * annen kundes data.
 *
 * Testen `ingen verktøyskjema eksponerer en org-parameter` håndhever dette maskinelt, og
 * `modellen kan ikke overstyre org` verifiserer at et forsøk fra modellen ignoreres.
 *
 * Hver spørring MÅ filtrere på `orgId`. Tabeller uten egen `org_id` (f.eks.
 * `safety_round_items`) må joine seg fram til forelderen som har den. Legger du til et
 * verktøy, utvid `ai-verktoy.test.ts` med en tilsvarende krysstest.
 */

import { readFile } from "node:fs/promises";
import { and, asc, count, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { deviations } from "../db/schema/avvik";
import { documents } from "../db/schema/dokumenter";
import { hazards, hmsGoals, safetyRoundItems, safetyRounds } from "../db/schema/internkontroll";
import { contracts } from "../db/schema/kontrakter";
import { completions, tasks } from "../db/schema/tasks";
import { buildingElements } from "../db/schema/vedlikehold";
import { vendors } from "../db/schema/vendors";
import { filSti } from "./lagring";
import { erForsinket } from "./oppgaveregler";

/**
 * Taket på hvor mange rader ett verktøykall returnerer. Modellen får et `avkortet`-flagg
 * tilbake, så den kan si fra til brukeren i stedet for å svare på et ufullstendig grunnlag.
 */
export const MAKS_RADER = 50;

function omDager(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function avkort<T>(rader: T[]) {
  return { rader: rader.slice(0, MAKS_RADER), avkortet: rader.length > MAKS_RADER };
}

// ---------------------------------------------------------------------------------------
// Verktøyene
// ---------------------------------------------------------------------------------------

async function hentKontrakter(db: Db, orgId: string, a: { kategori?: string; utloperInnenDager?: number }) {
  const betingelser = [
    eq(contracts.orgId, orgId),
    // Arkiverte avtaler er bevisst avsluttet og hører til historikken — rådgiveren skal
    // svare på hva som gjelder nå.
    isNull(contracts.archivedAt),
  ];
  if (a.kategori) betingelser.push(eq(contracts.category, a.kategori));
  if (a.utloperInnenDager !== undefined) {
    betingelser.push(sql`${contracts.endDate} IS NOT NULL AND ${contracts.endDate} <= ${omDager(a.utloperInnenDager)}`);
  }

  const rader = await db
    .select({ k: contracts, leverandor: vendors.name })
    .from(contracts)
    .leftJoin(vendors, eq(vendors.id, contracts.vendorId))
    .where(and(...betingelser))
    .orderBy(asc(contracts.endDate));

  const { rader: valgte, avkortet } = avkort(rader);
  return {
    avkortet,
    kontrakter: valgte.map((r) => ({
      id: r.k.id,
      tittel: r.k.title,
      leverandor: r.leverandor,
      kategori: r.k.category,
      arssum: r.k.annualSum,
      sluttdato: r.k.endDate,
      harDokument: Boolean(r.k.fileName),
      /** Om rådgiveren har lov til å LESE dokumentet — se `hentKontraktdokument`. */
      dokumentLesbart: r.k.aiReadable,
    })),
  };
}

/**
 * Leser innholdet i et avtaledokument.
 *
 * Krever `aiReadable` på kontrakten. Det er kundens eget opt-in per avtale: dokumentet kan
 * inneholde kommersielle vilkår de ikke vil sende til Anthropics API, selv om det er deres
 * egen rådgiver. Den som ikke har tatt stilling, deler ingenting.
 */
async function hentKontraktdokument(db: Db, orgId: string, a: { kontraktId: string }) {
  const rader = await db
    .select()
    .from(contracts)
    .where(and(eq(contracts.id, a.kontraktId), eq(contracts.orgId, orgId)))
    .limit(1);
  const k = rader[0];
  if (!k) return { feil: "Avtalen finnes ikke." };
  if (!k.aiReadable) {
    return {
      feil:
        "Dokumentet er ikke delt med AI-rådgiveren. Styret kan skru det på per avtale under " +
        "«Del dokument med AI-rådgiveren».",
    };
  }
  if (!k.fileName) return { feil: "Avtalen har ingen fil." };

  try {
    const innhold = await readFile(filSti(orgId, "contracts", k.fileName));
    return { tittel: k.title, filnavn: k.fileOriginalName, base64: innhold.toString("base64") };
  } catch {
    return { feil: "Filen finnes ikke på disk." };
  }
}

async function hentAvvik(db: Db, orgId: string, a: { status?: string; kunApne?: boolean }) {
  const betingelser = [eq(deviations.orgId, orgId)];
  if (a.status) betingelser.push(eq(deviations.status, a.status));
  else if (a.kunApne) betingelser.push(sql`${deviations.status} <> 'lukket'`);

  const rader = await db
    .select()
    .from(deviations)
    .where(and(...betingelser))
    .orderBy(desc(deviations.number));

  const { rader: valgte, avkortet } = avkort(rader);
  return {
    avkortet,
    avvik: valgte.map((d) => ({
      nummer: d.number,
      tittel: d.title,
      status: d.status,
      alvorlighet: d.severity,
      ansvarlig: d.assignedTo,
      frist: d.dueDate,
      meldtAv: d.reportedBy,
    })),
  };
}

async function hentInternkontrollStatus(db: Db, orgId: string) {
  const iAar = new Date().getFullYear();
  const [mal, farer, runder] = await Promise.all([
    db.select().from(hmsGoals).where(and(eq(hmsGoals.orgId, orgId), eq(hmsGoals.year, iAar))).limit(1),
    db.select().from(hazards).where(eq(hazards.orgId, orgId)),
    db.select().from(safetyRounds).where(eq(safetyRounds.orgId, orgId)).orderBy(desc(safetyRounds.roundDate)).limit(5),
  ]);

  return {
    aar: iAar,
    hmsMaal: mal[0] ? { tekst: mal[0].goalText, godkjent: mal[0].approved } : null,
    antallFarer: farer.length,
    // Samme grense som `risikoniva` i lib/internkontroll.ts: 6+ er høy på 1–3-skalaen.
    // NULL = ikke vurdert ennå — de er ikke «høye», de er ubesvarte.
    hoyRisiko: farer
      .filter((h) => h.probability != null && h.consequence != null && h.probability * h.consequence >= 6)
      .map((h) => h.title),
    vernerunder: runder.map((r) => ({ tittel: r.title, dato: r.roundDate, status: r.status })),
  };
}

async function hentOppgaver(db: Db, orgId: string, a: { kunForsinkede?: boolean; leverandor?: string }) {
  const betingelser = [eq(tasks.orgId, orgId), eq(tasks.active, true)];

  const rader = await db
    .select({ t: tasks, leverandor: vendors.name })
    .from(tasks)
    .leftJoin(vendors, eq(vendors.id, tasks.vendorId))
    .where(and(...betingelser))
    .orderBy(asc(tasks.title));

  const sist = await db
    .select({ taskId: completions.taskId, dato: sql<string>`max(${completions.completedAt})::date` })
    .from(completions)
    .groupBy(completions.taskId);
  const sistKart = new Map(sist.map((s) => [s.taskId, s.dato]));

  let beriket = rader.map((r) => {
    const lastCompletedAt = sistKart.get(r.t.id) ?? null;
    return {
      id: r.t.id,
      tittel: r.t.title,
      leverandor: r.leverandor,
      frekvens: r.t.frequency,
      sistUtfort: lastCompletedAt,
      // Samme regel som e-postvarselet og skjermen — se lib/oppgaveregler.ts.
      forsinket: erForsinket({ ...r.t, lastCompletedAt }),
    };
  });
  if (a.kunForsinkede) beriket = beriket.filter((t) => t.forsinket);
  if (a.leverandor) {
    beriket = beriket.filter((t) => t.leverandor?.toLowerCase().includes(a.leverandor!.toLowerCase()));
  }

  const { rader: valgte, avkortet } = avkort(beriket);
  return { avkortet, oppgaver: valgte };
}

async function hentVedlikeholdsplan(db: Db, orgId: string, a: { kategori?: string }) {
  const betingelser = [eq(buildingElements.orgId, orgId)];
  if (a.kategori) betingelser.push(eq(buildingElements.category, a.kategori));

  const rader = await db
    .select()
    .from(buildingElements)
    .where(and(...betingelser))
    .orderBy(asc(buildingElements.nextActionYear));

  const { rader: valgte, avkortet } = avkort(rader);
  return {
    avkortet,
    bygningsdeler: valgte.map((e) => ({
      navn: e.name,
      kategori: e.category,
      tilstandsgrad: e.conditionGrade,
      installertAr: e.installedYear,
      nesteTiltakAr: e.nextActionYear,
      estimertKostnad: e.estimatedCost,
      garantiUtloper: e.warrantyExpires,
    })),
  };
}

async function hentDokumentliste(db: Db, orgId: string, a: { mappe?: string }) {
  const betingelser = [eq(documents.orgId, orgId)];
  if (a.mappe) betingelser.push(eq(documents.folder, a.mappe));

  const rader = await db
    .select()
    .from(documents)
    .where(and(...betingelser))
    .orderBy(desc(documents.documentDate));

  const { rader: valgte, avkortet } = avkort(rader);
  return {
    avkortet,
    dokumenter: valgte.map((d) => ({
      id: d.id,
      tittel: d.title,
      mappe: d.folder,
      dato: d.documentDate,
      lesbart: d.aiReadable,
    })),
  };
}

/** Krever `aiReadable` på dokumentet — samme opt-in som for kontrakter. */
async function hentDokument(db: Db, orgId: string, a: { dokumentId: string }) {
  const rader = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, a.dokumentId), eq(documents.orgId, orgId)))
    .limit(1);
  const d = rader[0];
  if (!d) return { feil: "Dokumentet finnes ikke." };
  if (!d.aiReadable) {
    return {
      feil:
        "Dokumentet er ikke delt med AI-rådgiveren. Styret kan skru det på per dokument i " +
        "Dokumentarkivet.",
    };
  }

  try {
    const innhold = await readFile(filSti(orgId, "documents", d.filename));
    return { tittel: d.title, filnavn: d.originalName, base64: innhold.toString("base64") };
  } catch {
    return { feil: "Filen finnes ikke på disk." };
  }
}

const DATASETT = ["avvik_per_status", "oppgaver_forsinket", "vernerunde_punkter"] as const;

async function hentStatistikk(db: Db, orgId: string, a: { datasett: string }) {
  if (!(DATASETT as readonly string[]).includes(a.datasett)) {
    return { feil: `Ukjent datasett. Gyldige: ${DATASETT.join(", ")}.` };
  }

  if (a.datasett === "avvik_per_status") {
    const rader = await db
      .select({ status: deviations.status, antall: count() })
      .from(deviations)
      .where(eq(deviations.orgId, orgId))
      .groupBy(deviations.status);
    return { datasett: a.datasett, verdier: Object.fromEntries(rader.map((r) => [r.status, r.antall])) };
  }

  if (a.datasett === "oppgaver_forsinket") {
    const alle = await hentOppgaver(db, orgId, { kunForsinkede: true });
    return { datasett: a.datasett, antall: alle.oppgaver.length };
  }

  // `safety_round_items` har ingen egen org_id — den må joine seg fram til forelderen.
  // Uten joinen ville dette lekket sjekkpunkter på tvers av kunder.
  const rader = await db
    .select({ avhuket: safetyRoundItems.checked, antall: count() })
    .from(safetyRoundItems)
    .innerJoin(safetyRounds, eq(safetyRounds.id, safetyRoundItems.roundId))
    .where(eq(safetyRounds.orgId, orgId))
    .groupBy(safetyRoundItems.checked);
  return {
    datasett: a.datasett,
    avhuket: rader.find((r) => r.avhuket)?.antall ?? 0,
    ikkeAvhuket: rader.find((r) => !r.avhuket)?.antall ?? 0,
  };
}

// ---------------------------------------------------------------------------------------
// Registeret
// ---------------------------------------------------------------------------------------

type Verktoy = {
  navn: string;
  beskrivelse: string;
  /** JSON Schema for argumentene. MÅ ikke inneholde noen org-parameter. */
  skjema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  /**
   * `args` er utypet med vilje: den kommer fra modellen og er ikke å stole på. Hvert
   * verktøy plukker ut feltene sine selv, og et felt som ikke er der blir `undefined` —
   * aldri en org-id fra et sted den ikke skulle komme fra.
   */
  kjor: (db: Db, orgId: string, args: Record<string, unknown>) => Promise<unknown>;
};

export const VERKTOY: readonly Verktoy[] = [
  {
    navn: "hent_kontrakter",
    beskrivelse: "Aktive serviceavtaler. Kan filtreres på kategori eller utløpsdato.",
    skjema: {
      type: "object",
      properties: {
        kategori: { type: "string", description: "Fagfelt, f.eks. «Heis»" },
        utloperInnenDager: { type: "integer", description: "Kun avtaler som utløper innen N dager" },
      },
    },
    kjor: (db, orgId, a) => hentKontrakter(db, orgId, a as Parameters<typeof hentKontrakter>[2]),
  },
  {
    navn: "hent_kontraktdokument",
    beskrivelse: "Innholdet i et avtaledokument. Krever at styret har delt det med rådgiveren.",
    skjema: {
      type: "object",
      properties: { kontraktId: { type: "string" } },
      required: ["kontraktId"],
    },
    kjor: (db, orgId, a) => hentKontraktdokument(db, orgId, a as unknown as { kontraktId: string }),
  },
  {
    navn: "hent_avvik",
    beskrivelse: "Registrerte avvik. Kan filtreres på status.",
    skjema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["ny", "under_behandling", "lukket"] },
        kunApne: { type: "boolean" },
      },
    },
    kjor: (db, orgId, a) => hentAvvik(db, orgId, a as Parameters<typeof hentAvvik>[2]),
  },
  {
    navn: "hent_internkontroll_status",
    beskrivelse: "HMS-mål, kartlagte farer og siste vernerunder.",
    skjema: { type: "object", properties: {} },
    kjor: (db, orgId) => hentInternkontrollStatus(db, orgId),
  },
  {
    navn: "hent_oppgaver",
    beskrivelse: "Aktive driftsoppgaver med forsinkelsesstatus.",
    skjema: {
      type: "object",
      properties: {
        kunForsinkede: { type: "boolean" },
        leverandor: { type: "string", description: "Filtrer på leverandørnavn" },
      },
    },
    kjor: (db, orgId, a) => hentOppgaver(db, orgId, a as Parameters<typeof hentOppgaver>[2]),
  },
  {
    navn: "hent_vedlikeholdsplan",
    beskrivelse: "Anlegg (tekniske installasjoner og bygningsdeler) med tilstandsgrad, planlagte tiltak og kostnadsestimat. Kategori etter NS 3451: bygning, vvs, elkraft, tele, andre, utendors.",
    skjema: { type: "object", properties: { kategori: { type: "string" } } },
    kjor: (db, orgId, a) => hentVedlikeholdsplan(db, orgId, a as Parameters<typeof hentVedlikeholdsplan>[2]),
  },
  {
    navn: "hent_dokumentliste",
    beskrivelse: "Dokumenter i arkivet. Viser hvilke som er delt med rådgiveren.",
    skjema: { type: "object", properties: { mappe: { type: "string" } } },
    kjor: (db, orgId, a) => hentDokumentliste(db, orgId, a as Parameters<typeof hentDokumentliste>[2]),
  },
  {
    navn: "hent_dokument",
    beskrivelse: "Innholdet i et dokument. Krever at styret har delt det med rådgiveren.",
    skjema: {
      type: "object",
      properties: { dokumentId: { type: "string" } },
      required: ["dokumentId"],
    },
    kjor: (db, orgId, a) => hentDokument(db, orgId, a as unknown as { dokumentId: string }),
  },
  {
    navn: "hent_statistikk",
    beskrivelse: `Aggregerte tall. Gyldige datasett: ${DATASETT.join(", ")}.`,
    skjema: {
      type: "object",
      properties: { datasett: { type: "string", enum: [...DATASETT] } },
      required: ["datasett"],
    },
    kjor: (db, orgId, a) => hentStatistikk(db, orgId, a as unknown as { datasett: string }),
  },
] as const;

/** Verktøydefinisjonene slik Anthropics API vil ha dem. */
export function verktoyskjemaer() {
  return VERKTOY.map((v) => ({
    name: v.navn,
    description: v.beskrivelse,
    input_schema: v.skjema,
  }));
}

/**
 * Kjører ett verktøykall.
 *
 * `orgId` er andre argument og kommer fra kallstedet, ikke fra `args`. Sender modellen med
 * en `orgId`/`org_id` i argumentene, blir den ignorert — verktøyfunksjonene leser den aldri
 * derfra. Testen `modellen kan ikke overstyre org` verifiserer det.
 */
export async function kjorVerktoy(
  db: Db,
  orgId: string,
  navn: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const verktoy = VERKTOY.find((v) => v.navn === navn);
  if (!verktoy) return { feil: `Ukjent verktøy: ${navn}` };
  return verktoy.kjor(db, orgId, args);
}
