/**
 * Kunder uten gyldig selskapsform (BL-180) — og hva Enhetsregisteret sier de er.
 *
 * Migrasjon 0068 kobler bare kjente fritekstvarianter til en kode; resten blir stående med
 * `org_form_code = NULL`. Dette skriptet lister dem og slår opp org.nr hos Brreg for å
 * FORESLÅ en kode. Det skriver ingenting: rettingen gjøres i panelet (Rediger eller
 * «Krever handling»), så valget er et menneskes.
 *
 * Når lista er tom i både test og prod, kan fritekstkolonnen `org_form` droppes.
 *
 *   docker compose exec app npx tsx scripts/selskapsform-rapport.ts
 */

import { isNull } from "drizzle-orm";
import { lukkPooler, withoutRls } from "../src/db/client";
import { organizations } from "../src/db/schema/organizations";
import { hentEnhet } from "../src/lib/brreg";
import { erSelskapsform, selskapsformNavn } from "../src/lib/selskapsform";

async function main() {
  const rader = await withoutRls("migrasjon", (db) =>
    db
      .select({
        navn: organizations.name,
        orgNr: organizations.orgNr,
        gammel: organizations.orgFormGammel,
      })
      .from(organizations)
      .where(isNull(organizations.orgForm)),
  );

  if (rader.length === 0) {
    console.log("Alle kunder har gyldig selskapsform.");
    return;
  }

  console.log(`${rader.length} kunde(r) uten selskapsform:\n`);
  for (const r of rader) {
    let forslag = "ingen org.nr å slå opp";
    if (r.orgNr) {
      const enhet = await hentEnhet(r.orgNr);
      if (!enhet) forslag = "fant ikke org.nr hos Brreg";
      else if (erSelskapsform(enhet.orgFormKode)) {
        forslag = `${enhet.orgFormKode} (${selskapsformNavn(enhet.orgFormKode)})`;
      } else forslag = `Brreg sier ${enhet.orgFormKode ?? "?"}, som ikke er på listen`;
    }
    console.log(`- ${r.navn}: tidligere «${r.gammel ?? ""}», forslag: ${forslag}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void lukkPooler());
