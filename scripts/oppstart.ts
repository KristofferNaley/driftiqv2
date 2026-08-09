/**
 * Oppstart: migrasjoner, approlle og RLS-policyer. Arvtakeren til `_apply_migrations()` +
 * `rls.sett_opp()` i v1s `main.py`.
 *
 * Rekkefølgen er ikke valgfri:
 *
 *   1. migrasjoner  — tabellene må finnes før noe kan gis rettigheter på dem
 *   2. settOpp      — oppretter approllen, gir GRANTs, legger på policyene
 *   3. verifiser    — at rollene faktisk har egenskapene oppsettet hviler på
 *
 * Alt skal tåle å kjøres om igjen. Kjøres ved hver containeroppstart, som i v1.
 */

import { existsSync } from "node:fs";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { adminPool, dbNavn, lukkPooler, medEierklient, verifiserRoller } from "../src/db/client";
import { settOpp } from "../src/db/rls/setup";

const APP_DB_USER = process.env.APP_DB_USER ?? "driftiq_v2_app";
const APP_DB_PASSWORD = process.env.APP_DB_PASSWORD;

async function main(): Promise<void> {
  if (!APP_DB_PASSWORD) {
    throw new Error("APP_DB_PASSWORD er ikke satt — se .env.v2.example");
  }

  // Migrasjonene genereres av `npm run db:generate` og sjekkes inn. Er de ikke laget ennå
  // (fersk klone, før første generate), skal containeren si det tydelig — ikke crash-loope
  // på en kryptisk feil fra migratoren om en manglende journalfil.
  if (!existsSync("./drizzle/meta/_journal.json")) {
    throw new Error(
      "Fant ingen migrasjoner under ./drizzle. Kjør `npm run db:generate` og sjekk inn " +
        "resultatet før containeren startes. Se v2/README.md, «Første gang».",
    );
  }

  console.log("[oppstart] kjører migrasjoner …");
  await migrate(drizzle(adminPool), { migrationsFolder: "./drizzle" });

  console.log("[oppstart] setter opp approlle og RLS-policyer …");
  await medEierklient(async (client) => {
    await settOpp(client, {
      approlle: APP_DB_USER,
      apppassord: APP_DB_PASSWORD,
      database: dbNavn(),
    });
  });

  await verifiserRoller();
  console.log(`[rls] Aktiv — appen kobler til som «${APP_DB_USER}», underlagt policyene.`);
}

main()
  .then(() => lukkPooler())
  .then(() => process.exit(0))
  .catch(async (e) => {
    console.error("[oppstart] FEILET:", e instanceof Error ? e.message : e);
    await lukkPooler().catch(() => {});
    process.exit(1);
  });
