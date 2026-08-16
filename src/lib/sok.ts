/**
 * Globalt søk — på tvers av modulene, servert av Postgres.
 *
 * ## Hvorfor ingen søkeindekstabell
 *
 * En egen `search_index` er en kopi av dataene, og en kopi kan drifte: raden som ble endret
 * uten at indeksen fulgte med, er usynlig i søket uten feilmelding — samme klasse problem
 * som registerfilene i CLAUDE.md verner mot. GIN-uttrykksindekser rett på tabellene har
 * ingen synk å glemme, og holder lenge på denne datamengden.
 *
 * ## Hvorfor per-tabell-spørringer og ikke én UNION
 *
 * Hver spørring beholder sitt synlige `.where(eq(x.orgId, orgId))` (applikasjonsfilteret
 * skal stå selv om RLS også stopper det), modulgaten blir «hopp over spørringen» i stedet
 * for dynamisk SQL, og `ts_rank` er uansett ikke sammenlignbar på tvers av tabeller — en
 * global rangering ville vært falsk presisjon. UI-et grupperer per modul.
 *
 * ## FTS + ILIKE er begge nødvendige
 *
 * Norsk snowball-stemming dekomponerer ikke sammensatte ord: «lekkasje» treffer ALDRI
 * «vannlekkasje» via to_tsvector. ILIKE-grenen (med trigram-indeks) er norsken, ikke en
 * reserve — fjern den ikke «for ytelse».
 *
 * ## Uttrykkene speiler indeksene
 *
 * `KILDER[].fts` må være semantisk identisk med uttrykket i drizzle/0047_sok_indekser.sql
 * (samme kolonner, samme coalesce, samme rekkefølge) — Postgres matcher indeksen på
 * uttrykkstreet, og et avvik gir stille seq scan. Endres én av dem, endres begge.
 *
 * ## Utvidelse til barnetabeller
 *
 * Alle ti kildene har egen org_id (DIREKTE_TABELLER). Skal søket senere dekke en
 * barnetabell (f.eks. safety_round_items), må spørringen gå EXISTS mot forelderen — se
 * BARNETABELLER i src/db/rls/tables.ts.
 */

import { and, eq, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { Db } from "../db/client";
import { annualEvents } from "../db/schema/arshjul";
import { deviations } from "../db/schema/avvik";
import { documents } from "../db/schema/dokumenter";
import { logEntries } from "../db/schema/driftslogg";
import { hazards } from "../db/schema/internkontroll";
import { contracts } from "../db/schema/kontrakter";
import { organizations } from "../db/schema/organizations";
import { routines } from "../db/schema/rutiner";
import { tasks } from "../db/schema/tasks";
import { buildingElements } from "../db/schema/vedlikehold";
import { vendors } from "../db/schema/vendors";
import { modulErAktivert, type ModulNokkel } from "./moduler";

export const sokSkjema = z.object({
  q: z.string().trim().min(2, "Skriv minst to tegn").max(100, "Søket er for langt"),
});

export type SokTreff = {
  modul: ModulNokkel;
  id: string;
  tittel: string;
  /** Utdrag av beskrivelse/notat — konteksten som sier hvorfor raden traff. */
  undertekst: string | null;
  dato: string | null;
  /** Kun avvik: løpenummeret, så UI-et kan vise «#21». */
  nummer: number | null;
};

/** Maks treff per modul. Søket er en inngang, ikke en rapport. */
const MAKS_PER_KILDE = 10;

type Kilde = {
  modul: ModulNokkel;
  tabell: PgTable;
  orgId: AnyPgColumn;
  id: AnyPgColumn;
  /** MÅ speile indeksuttrykket i drizzle/0047_sok_indekser.sql. */
  fts: SQL;
  /** Kolonnen trigram-indeksen står på — ILIKE-grenen. */
  tittel: AnyPgColumn;
  undertekst: SQL;
  dato: SQL;
  /** Kun avvik. */
  nummer?: AnyPgColumn;
};

const KILDER: readonly Kilde[] = [
  {
    modul: "avvik",
    tabell: deviations,
    orgId: deviations.orgId,
    id: deviations.id,
    fts: sql`to_tsvector('norwegian', coalesce(${deviations.title},'') || ' ' || coalesce(${deviations.description},'') || ' ' || coalesce(${deviations.resolutionNotes},''))`,
    tittel: deviations.title,
    undertekst: sql`left(coalesce(${deviations.description},''), 140)`,
    dato: sql`${deviations.reportedAt}::date::text`,
    nummer: deviations.number,
  },
  {
    modul: "tasks",
    tabell: tasks,
    orgId: tasks.orgId,
    id: tasks.id,
    fts: sql`to_tsvector('norwegian', coalesce(${tasks.title},'') || ' ' || coalesce(${tasks.description},''))`,
    tittel: tasks.title,
    undertekst: sql`left(coalesce(${tasks.description},''), 140)`,
    dato: sql`${tasks.createdAt}::date::text`,
  },
  {
    modul: "kontrakter",
    tabell: contracts,
    orgId: contracts.orgId,
    id: contracts.id,
    fts: sql`to_tsvector('norwegian', coalesce(${contracts.title},'') || ' ' || coalesce(${contracts.notes},''))`,
    tittel: contracts.title,
    undertekst: sql`left(coalesce(${contracts.notes},''), 140)`,
    dato: sql`${contracts.startDate}::text`,
  },
  {
    modul: "dokumentarkiv",
    tabell: documents,
    orgId: documents.orgId,
    id: documents.id,
    fts: sql`to_tsvector('norwegian', coalesce(${documents.title},'') || ' ' || coalesce(${documents.description},'') || ' ' || coalesce(${documents.originalName},''))`,
    tittel: documents.title,
    undertekst: sql`left(coalesce(${documents.description}, ${documents.originalName}, ''), 140)`,
    dato: sql`${documents.uploadedAt}::date::text`,
  },
  {
    modul: "driftslogg",
    tabell: logEntries,
    orgId: logEntries.orgId,
    id: logEntries.id,
    fts: sql`to_tsvector('norwegian', coalesce(${logEntries.title},'') || ' ' || coalesce(${logEntries.description},''))`,
    tittel: logEntries.title,
    undertekst: sql`left(coalesce(${logEntries.description},''), 140)`,
    dato: sql`${logEntries.createdAt}::date::text`,
  },
  {
    modul: "rutiner",
    tabell: routines,
    orgId: routines.orgId,
    id: routines.id,
    fts: sql`to_tsvector('norwegian', coalesce(${routines.title},'') || ' ' || coalesce(${routines.description},''))`,
    tittel: routines.title,
    undertekst: sql`left(coalesce(${routines.description},''), 140)`,
    dato: sql`${routines.createdAt}::date::text`,
  },
  {
    modul: "leverandorer",
    tabell: vendors,
    orgId: vendors.orgId,
    id: vendors.id,
    fts: sql`to_tsvector('norwegian', coalesce(${vendors.name},'') || ' ' || coalesce(${vendors.notes},''))`,
    tittel: vendors.name,
    undertekst: sql`left(coalesce(${vendors.notes},''), 140)`,
    dato: sql`${vendors.createdAt}::date::text`,
  },
  {
    modul: "arshjul",
    tabell: annualEvents,
    orgId: annualEvents.orgId,
    id: annualEvents.id,
    fts: sql`to_tsvector('norwegian', coalesce(${annualEvents.title},'') || ' ' || coalesce(${annualEvents.description},''))`,
    tittel: annualEvents.title,
    undertekst: sql`left(coalesce(${annualEvents.description},''), 140)`,
    dato: sql`${annualEvents.createdAt}::date::text`,
  },
  {
    modul: "vedlikehold",
    tabell: buildingElements,
    orgId: buildingElements.orgId,
    id: buildingElements.id,
    fts: sql`to_tsvector('norwegian', coalesce(${buildingElements.name},'') || ' ' || coalesce(${buildingElements.notes},''))`,
    tittel: buildingElements.name,
    undertekst: sql`left(coalesce(${buildingElements.notes},''), 140)`,
    dato: sql`${buildingElements.createdAt}::date::text`,
  },
  {
    modul: "internkontroll",
    tabell: hazards,
    orgId: hazards.orgId,
    id: hazards.id,
    fts: sql`to_tsvector('norwegian', coalesce(${hazards.title},'') || ' ' || coalesce(${hazards.description},''))`,
    tittel: hazards.title,
    undertekst: sql`left(coalesce(${hazards.description},''), 140)`,
    dato: sql`${hazards.createdAt}::date::text`,
  },
];

/**
 * Bygger tsquery-delene av søket.
 *
 * `websearch_to_tsquery` tåler hva som helst av input (den kaster aldri), men støtter ikke
 * prefiks — derfor et separat `to_tsquery`-ledd med `:*` på siste ord, så «vannle» treffer
 * «vannlekkasje» mens man skriver. `to_tsquery` KASTER derimot på `&`, `!`, `(` osv., så
 * ordet strippes til bokstaver og tall først: «heis & port» skal gi treff, ikke 500.
 */
function tsquerySql(q: string): SQL {
  const ord = q
    .split(/\s+/)
    .map((o) => o.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  const siste = ord[ord.length - 1];
  if (!siste) return sql`websearch_to_tsquery('norwegian', ${q})`;
  return sql`(websearch_to_tsquery('norwegian', ${q}) || to_tsquery('norwegian', ${siste + ":*"}))`;
}

export async function hentGlobaltSok(db: Db, orgId: string, q: string): Promise<SokTreff[]> {
  // Modulgaten ligger HER, ikke i rutelaget: søket går på tvers av moduler, og gaten blir
  // «ikke spør den tabellen» — treff fra en modul kunden ikke har, skal ikke finnes.
  const orgRader = await db
    .select({ enabledModules: organizations.enabledModules })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  const lagret = orgRader[0]?.enabledModules;

  const tsquery = tsquerySql(q);
  const somDelord = `%${q}%`;
  // «#21» eller «21» skal treffe avviksnummeret — samme mønster som avvikssidens eget søk.
  const nummer = /^#?(\d{1,6})$/.exec(q.trim());

  const alle: SokTreff[] = [];
  // Sekvensielt på withOrg-klienten (én tilkobling — Promise.all ville uansett
  // serialisert). Ti indekserte spørringer med LIMIT er millisekunder til sammen.
  for (const kilde of KILDER.filter((k) => modulErAktivert(lagret, k.modul))) {
    const treffBetingelse = or(
      sql`${kilde.fts} @@ ${tsquery}`,
      sql`${kilde.tittel} ILIKE ${somDelord}`,
      ...(kilde.nummer && nummer ? [eq(kilde.nummer, Number(nummer[1]))] : []),
    )!;

    const rader = await db
      .select({
        id: kilde.id,
        tittel: kilde.tittel,
        undertekst: kilde.undertekst.as("undertekst"),
        dato: kilde.dato.as("dato"),
        ...(kilde.nummer ? { nummer: kilde.nummer } : {}),
      })
      .from(kilde.tabell)
      .where(and(eq(kilde.orgId, orgId), treffBetingelse))
      .orderBy(sql`ts_rank(${kilde.fts}, ${tsquery}) DESC`)
      .limit(MAKS_PER_KILDE);

    for (const rad of rader) {
      alle.push({
        modul: kilde.modul,
        id: String(rad.id),
        tittel: String(rad.tittel),
        undertekst: (rad.undertekst as string | null) || null,
        dato: (rad.dato as string | null) ?? null,
        nummer: "nummer" in rad && rad.nummer != null ? Number(rad.nummer) : null,
      });
    }
  }
  return alle;
}
