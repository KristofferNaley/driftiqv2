/**
 * Kjøringsloggen for appens bakgrunnsjobber — skrives av jobben selv, leses av
 * plattformpanelet. Én rad per fullført kjøring; en jobb som krasjet får ok = false med
 * feilmeldingen som detalj. Raden skrives ETTER kjøringen: en halvskrevet «pågår»-tilstand
 * ville krevd opprydding etter hver restart.
 */

import { randomUUID } from "node:crypto";
import { desc, inArray } from "drizzle-orm";
import { withoutRls, type Db } from "../db/client";
import { jobRuns, type JobRun } from "../db/schema/platform";
import { JOBBER } from "./jobber";

/** Kjører jobben og logger utfallet. Kaster videre — feilhåndteringen eies av kalleren. */
export async function medKjoringslogg(nokkel: string, fn: () => Promise<string>): Promise<void> {
  const start = new Date();
  const logg = async (ok: boolean, detail: string) => {
    await withoutRls("bakgrunnsjobb", (db) =>
      db.insert(jobRuns).values({
        id: randomUUID(), job: nokkel, startedAt: start, finishedAt: new Date(), ok, detail,
      }),
    );
  };

  try {
    const detalj = await fn();
    await logg(true, detalj);
  } catch (e) {
    // Loggfeilen skal aldri skygge for jobbfeilen.
    await logg(false, e instanceof Error ? e.message : String(e)).catch(() => {});
    throw e;
  }
}

/** Siste kjøring per jobb — til statuskolonnen i panelet. */
export async function sisteKjoringer(db: Db): Promise<Map<string, JobRun>> {
  const rader = await db
    .select()
    .from(jobRuns)
    .where(inArray(jobRuns.job, JOBBER.map((j) => j.nokkel)))
    .orderBy(desc(jobRuns.startedAt))
    .limit(50);

  const siste = new Map<string, JobRun>();
  for (const r of rader) {
    if (!siste.has(r.job)) siste.set(r.job, r);
  }
  return siste;
}
