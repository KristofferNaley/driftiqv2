/**
 * Boligbyggelag uten fylke, men med gammel fritekst-region (01.10.2026).
 *
 * Migrasjon 0069 tolker bare kjente skrivemåter (fylkesnavnene og «Vestlandet»); resten blir
 * stående i `bbl.region` med `county_codes = NULL`. Dette skriptet lister dem. Det skriver
 * ingenting: fylke velges i panelet (Innstillinger › Boligbyggelag › Rediger), som også
 * rydder friteksten.
 *
 * Når lista er tom i både test og prod, kan kolonnen `region` droppes.
 *
 *   docker compose exec app npx tsx scripts/fylke-rapport.ts
 */

import { and, isNotNull, isNull } from "drizzle-orm";
import { lukkPooler, withoutRls } from "../src/db/client";
import { bbl } from "../src/db/schema/bbl";

async function main() {
  const rader = await withoutRls("migrasjon", (db) =>
    db
      .select({ navn: bbl.name, region: bbl.region })
      .from(bbl)
      .where(and(isNull(bbl.countyCodes), isNotNull(bbl.region))),
  );

  if (rader.length === 0) {
    console.log("Ingen boligbyggelag har region som ikke ble tolket.");
    return;
  }

  console.log(`${rader.length} boligbyggelag med region som ikke ble tolket:\n`);
  for (const r of rader) console.log(`- ${r.navn}: «${r.region}»`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void lukkPooler());
