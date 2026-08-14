/**
 * Systemhelse for plattformpanelet. Løser samme behov som v1s `/superadmin/system`, men
 * ikke på samme måte.
 *
 * ## Hva som er annerledes fra v1, og hvorfor
 *
 * **Ingen forespørselslogg.** v1 holdt de siste 200 forespørslene i en ring-buffer på
 * `app.state` og viste dem her. Det var nyttig fordi FastAPI-appen var én prosess. Next.js
 * kjører rutene i flere kontekster, og en buffer i minnet ville vist et tilfeldig utvalg av
 * trafikken — verre enn ingen logg, fordi den ser ut som hele bildet. Trenger vi dette,
 * hører det hjemme i et faktisk loggverktøy, ikke i en variabel.
 *
 * **`rls_aktiv` er ikke en konfigurasjonsverdi lenger.** v1 leste et flagg som ble satt ved
 * oppstart. v2 nekter å starte uten RLS (se `db/client.ts`), så et slikt flagg ville alltid
 * vært `true` og dermed verdiløst. Her SPØR vi databasen i stedet: hvilken rolle er vi
 * tilkoblet som, og står `FORCE ROW LEVEL SECURITY` faktisk på tabellene. Det er et svar som
 * kan bli nei.
 */

import { readFileSync } from "node:fs";
import { statfs } from "node:fs/promises";
import os from "node:os";
import { sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { appPool, dbNavn } from "../db/client";
import { DIREKTE_TABELLER } from "../db/rls/tables";
import { JOBBER, nesteKjoring } from "./jobber";
import { sisteKjoringer } from "./jobbkjoring";

const GB = 1024 ** 3;
const MB = 1024 ** 2;

/** Versjonen av Next.js som faktisk kjører — lest fra pakken, ikke hardkodet. */
function nextVersjon(): string {
  try {
    const p = JSON.parse(readFileSync("./node_modules/next/package.json", "utf8"));
    return typeof p.version === "string" ? p.version : "ukjent";
  } catch {
    return "ukjent";
  }
}

function tid(sekunder: number): string {
  const d = Math.floor(sekunder / 86400);
  const t = Math.floor((sekunder % 86400) / 3600);
  const m = Math.floor((sekunder % 3600) / 60);
  return d > 0 ? `${d}d ${t}t ${m}m` : t > 0 ? `${t}t ${m}m` : `${m}m`;
}

export async function hentSystemhelse(db: Db) {
  const [tilkobling, approlle, storrelse, rls, disk] = await Promise.all([
    db.execute<{ versjon: string }>(sql`select version() as versjon`),
    /**
     * Rollen KUNDEAPPEN kobler til som — målt på appPool, ikke på denne forespørselens
     * tilkobling. Plattformpanelet kjører med vilje på admin-poolen (withoutRls), så en
     * `current_user` her ville alltid vist eierrollen: sjekken målte sitt eget speilbilde
     * og ropte varsel om det (påvist 14.08.2026).
     */
    appPool.query<{ bruker: string }>("select current_user as bruker"),
    db.execute<{ bytes: string }>(sql`select pg_database_size(current_database()) as bytes`),
    /**
     * Står RLS faktisk på? `relrowsecurity` er «policyene gjelder», `relforcerowsecurity`
     * er «de gjelder også for tabellens eier». Uten den andre ville eieren sett alt.
     */
    db.execute<{ tabell: string; pa: boolean; tvunget: boolean }>(sql`
      select relname as tabell, relrowsecurity as pa, relforcerowsecurity as tvunget
      from pg_class
      where relnamespace = 'public'::regnamespace and relkind = 'r'
    `),
    diskbruk(),
  ]);

  const siste = await sisteKjoringer(db);

  const rader = rls.rows ?? [];
  const dekket = new Map(rader.map((r) => [r.tabell, r]));
  // Bare tabellene som SKAL ha policy. En manglende her er en reell hull i isolasjonen.
  const mangler = DIREKTE_TABELLER.filter((t) => {
    const r = dekket.get(t);
    return !r || !r.pa || !r.tvunget;
  });

  const minne = process.memoryUsage();
  const bruker = approlle.rows?.[0]?.bruker ?? "ukjent";

  return {
    database: {
      navn: dbNavn(),
      /**
       * Kobler appen til som EIER, er RLS omgått uansett hva policyene sier. Derfor vises
       * rollenavnet, ikke bare et grønt lys.
       */
      rolle: bruker,
      erApprolle: bruker === (process.env.APP_DB_USER ?? "driftiq_v2_app"),
      storrelseMb: Math.round(Number(storrelse.rows?.[0]?.bytes ?? 0) / MB),
      versjon: (tilkobling.rows?.[0]?.versjon ?? "").split(" ").slice(0, 2).join(" "),
    },
    rls: {
      antallTabeller: DIREKTE_TABELLER.length,
      mangler,
    },
    kjoretid: {
      node: process.version,
      next: nextVersjon(),
      /** Hvor lenge APPEN har kjørt — ikke verten. Det er appen som restartes ved deploy. */
      oppetid: tid(process.uptime()),
      minneMb: Math.round(minne.rss / MB),
    },
    vert: {
      oppetid: tid(os.uptime()),
      minneBruktMb: Math.round((os.totalmem() - os.freemem()) / MB),
      minneTotaltMb: Math.round(os.totalmem() / MB),
      /** Lastesnitt siste minutt per kjerne — 1,0 betyr «akkurat full». */
      last: Number((os.loadavg()[0]! / Math.max(os.cpus().length, 1)).toFixed(2)),
    },
    disk,
    /**
     * Alle bakgrunnsjobbene — appens egne og vertens crontab — med siste og neste kjøring.
     * «Kjørte varslene i natt?» er det første man lurer på når en kunde ikke fikk e-post.
     */
    jobber: JOBBER.map((j) => {
      const s = siste.get(j.nokkel);
      return {
        nokkel: j.nokkel,
        navn: j.navn,
        beskrivelse: j.beskrivelse,
        plan: j.plan,
        kilde: j.kilde,
        logg: j.logg ?? null,
        neste: nesteKjoring(j.cron, j.timezone)?.toISOString() ?? null,
        siste: s
          ? { naar: s.finishedAt.toISOString(), ok: s.ok, detail: s.detail }
          : null,
      };
    }),
  };
}

async function diskbruk() {
  try {
    const s = await statfs("/app");
    const totalt = s.blocks * s.bsize;
    const ledig = s.bavail * s.bsize;
    return {
      totaltGb: Number((totalt / GB).toFixed(1)),
      bruktGb: Number(((totalt - ledig) / GB).toFixed(1)),
      prosent: totalt > 0 ? Math.round((100 * (totalt - ledig)) / totalt) : 0,
    };
  } catch {
    // Kjører vi et sted uten `/app` (tester lokalt), er dette ikke en feil verdt å velte på.
    return null;
  }
}
