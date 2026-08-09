/**
 * Sender en testmelding for å verifisere e-postoppsettet.
 *
 * Kjøres når et miljø settes opp, eller når nøkkel/avsenderdomene endres — det er lettere å
 * oppdage et uverifisert domene her enn gjennom en invitasjon som stille aldri kom fram.
 *
 *   docker run --rm --network edge --env-file .env -v "$PWD:/app" -w /app node:22-alpine \
 *     npx tsx scripts/test-epost.ts kristoffer@driftiq.no
 *
 * Adressen må stå i `EPOST_TILLATTE_DOMENER` hvis domenevakten er på — ellers blokkeres den,
 * og skriptet sier fra om nettopp det i stedet for å se ut som en vellykket sending.
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
  await sendKontooppsett("Test Testesen", til, `${APP_URL}/nytt-passord?token=TEST`);
  console.log(`\nSendt til ${til}. Kommer den ikke fram, sjekk at avsenderdomenet er`);
  console.log("verifisert i Resend — en uverifisert avsender avvises der, ikke her.");
}

void main();
