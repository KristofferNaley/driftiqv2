/**
 * Sender en testmelding for å verifisere e-postoppsettet.
 *
 * Kjøres når et miljø settes opp, eller når nøkkel/avsenderdomene endres — det er lettere å
 * oppdage et uverifisert domene her enn gjennom en invitasjon som stille aldri kom fram.
 *
 *   docker compose exec app npx tsx scripts/test-epost.ts kristoffer@driftiq.no
 *
 * Kjøres i appcontaineren fordi verten ikke har `node_modules`. Containeren har miljøet fra
 * forrige oppstart — er `.env` endret uten ny `up`, send den nye verdien med:
 *
 *   docker compose exec -e "FROM_EMAIL=DriftIQ <hei@varsel.driftiq.no>" app npx tsx …
 *
 * Adressen må stå i `EPOST_TILLATTE_DOMENER` hvis domenevakten er på — ellers blokkeres den,
 * og skriptet sier fra om nettopp det i stedet for å se ut som en vellykket sending.
 *
 * Avslutter med feilkode når Resend avviser. Første versjon skrev «Sendt» uansett, fordi
 * `send()` bare logger avvisningen — og en avvist avsender (API-nøkkel uten tilgang til
 * domenet, 02.09.2026) så ut som en vellykket test.
 */

import { mottakerTillatt, sendKontooppsett, APP_URL } from "../src/lib/epost";

async function main(): Promise<void> {
  const til = process.argv[2];
  if (!til) {
    console.error("Bruk: npx tsx scripts/test-epost.ts <e-postadresse>");
    process.exit(1);
  }

  if (!process.env.RESEND_API_KEY) {
    console.error("RESEND_API_KEY er ikke satt — ingenting ville blitt sendt.");
    process.exit(1);
  }

  console.log(`Avsender:  ${process.env.FROM_EMAIL ?? "(standard)"}`);
  console.log(`Lenkebase: ${APP_URL}`);
  console.log(`Vakt:      ${process.env.EPOST_TILLATTE_DOMENER || "(av)"}`);

  if (!mottakerTillatt(til)) {
    console.error(
      `\nBLOKKERT: ${til} står ikke i EPOST_TILLATTE_DOMENER. Legg den til, eller tøm ` +
        "variabelen for å slå av vakten.",
    );
    process.exit(1);
  }

  // Velkomstmalen, fordi den har både overskrift, brødtekst og knapp — ser den riktig ut,
  // gjør de andre det også.
  const resultat = await sendKontooppsett("Test Testesen", til, `${APP_URL}/nytt-passord?token=TEST`);
  if (!resultat.ok) {
    console.error(`\nIKKE SENDT (${resultat.grunn}): ${resultat.melding}`);
    if (resultat.grunn === "avvist") {
      console.error("Sjekk i Resend at avsenderdomenet er verifisert OG at API-nøkkelen har tilgang til det.");
    }
    process.exit(1);
  }
  console.log(`\nSendt til ${til} (${resultat.id ?? "uten id"}). Sjekk innboksen.`);
}

void main();
