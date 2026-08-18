import { connection } from "next/server";

/**
 * Sporingsskriptet for Umami, lastet førsteparts fra `/stats/script.js` (se proxyen i
 * `src/app/stats/[...sti]/route.ts`).
 *
 * ## To flater, to nettsteds-ID-er
 *
 * Landingssiden og kunde-appen telles hver for seg, som i v1 — ellers blandes «hvor mange
 * fant oss» med «hvor mye brukes produktet», og begge tallene blir ubrukelige.
 * Plattformpanelet har bevisst INGEN: det er vår egen arbeidsflate, og å måle oss selv ville
 * bare forurenset tallene.
 *
 * ## `connection()` — og hva den koster
 *
 * Uten den leses `process.env` under `next build`, der miljøvariablene fra compose ikke
 * finnes. Landingssiden er statisk prerendret, så ID-en ville blitt bakt inn som tom streng
 * og sporingen vært stille av — nøyaktig den feilformen resten av dette repoet er bygget for
 * å unngå. `connection()` flytter lesingen til forespørselstidspunktet.
 *
 * Prisen er at siden går fra statisk til server-rendret per forespørsel. Det er en reell,
 * men liten kostnad: siden henter ingen data, og argumentet for serverkomponenter i
 * `(marked)/layout.tsx` er at HTML-en skal komme ferdig — ikke at den skal komme fra en
 * bygget fil. SSR oppfyller det like godt, og søkemotorer ser ingen forskjell.
 *
 * ## Tom ID = av
 *
 * Samme mønster som `RESEND_API_KEY` og `ANTHROPIC_API_KEY`: er variabelen ikke satt,
 * skjer det ingenting, og alt annet virker. Lokalt og i test finnes ingen Umami i det hele
 * tatt, og da skal det ikke ligge et skript og feile i konsollen.
 */
export async function Webanalyse({ flate }: { flate: "marked" | "app" }) {
  await connection();

  const nettsted =
    flate === "marked"
      ? process.env.UMAMI_NETTSTED_MARKED
      : process.env.UMAMI_NETTSTED_APP;
  if (!nettsted) return null;

  // Vanlig <script defer>, ikke next/script: taggen skal stå i HTML-en som kommer fra
  // serveren. `next/script` med afterInteractive injiseres av React etter hydrering, og da
  // mister vi besøkene som forlater siden før JS-en er ferdig — som er nettopp de besøkene
  // en landingsside trenger å vite om.
  return <script defer src="/stats/script.js" data-website-id={nettsted} />;
}
