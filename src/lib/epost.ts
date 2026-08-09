/**
 * All utgående e-post. Port av v1s `email.py`, inkludert malen og domenevakten.
 *
 * Sending skjer gjennom Resend. Uten `RESEND_API_KEY` sendes ingenting, og appen kjører
 * videre — et manglende varsel skal aldri velte en handling brukeren utførte.
 */

import { Resend } from "resend";
import { APP_URL } from "./urler";

export { APP_URL };

const API_KEY = process.env.RESEND_API_KEY ?? "";
const FRA = process.env.FROM_EMAIL ?? "DriftIQ <noreply@driftiq.no>";


/**
 * ## Domenevakt for test- og utviklingsmiljø
 *
 * Testdatabasen er en kopi av produksjon og inneholder ekte, leverbare adresser. Uten en
 * vakt her sender testmiljøet ekte e-post til ekte mennesker — og de personlige varslene
 * (mitt avvik, mine forsinkede oppgaver) er PÅ som standard for alle.
 *
 * `EPOST_TILLATTE_DOMENER` er kommaseparert. Oppføringer med @ er nøyaktige adresser, uten
 * @ er hele domener:
 *
 *     EPOST_TILLATTE_DOMENER=driftiq.test,example.com,meg@gmail.com
 *
 * Vakten er AV når variabelen ikke er satt. Det er med vilje: produksjon skal ikke være
 * avhengig av at noen husker å konfigurere den, og en glemt variabel skal aldri kunne gjøre
 * kundene stille. Den skrus PÅ i testmiljøet, ikke av i prod.
 */
const FILTER = (process.env.EPOST_TILLATTE_DOMENER ?? "")
  .split(",")
  .map((o) => o.trim().toLowerCase())
  .filter(Boolean);

export function mottakerTillatt(til: string): boolean {
  if (FILTER.length === 0) return true;
  const adresse = (til ?? "").trim().toLowerCase();
  const domene = adresse.split("@").pop() ?? "";
  return FILTER.some((o) => (o.includes("@") ? o === adresse : o.replace(/^@/, "") === domene));
}

async function send(til: string, emne: string, html: string): Promise<void> {
  if (!API_KEY) return;
  if (!mottakerTillatt(til)) {
    // Logges høyt: en e-post som forsvinner stille under testing ser ut som en feil i
    // koden, og da leter man på feil sted.
    console.warn(`[epost] BLOKKERT av domenevakt — ${til} ville fått «${emne}»`);
    return;
  }
  try {
    const svar = await new Resend(API_KEY).emails.send({
      from: FRA,
      to: [til],
      subject: emne,
      html,
    });
    // Resends SDK KASTER IKKE ved API-feil — den returnerer `{ data, error }`. Uten denne
    // sjekken ser en avvist sending (uverifisert avsenderdomene er det vanlige) nøyaktig ut
    // som en vellykket, og feilen oppdages først når noen sier at e-posten aldri kom.
    if (svar.error) {
      console.error(`[epost] Resend avviste sending til ${til}: ${svar.error.message}`);
      return;
    }
    console.log(`[epost] Sendt til ${til} (${svar.data?.id ?? "uten id"}) — «${emne}»`);
  } catch (e) {
    // Nettverksfeil o.l. Sendingen skal aldri velte kallet som utløste den: brukeren har
    // gjort noe som lyktes, og at varselet ikke kom fram er en driftssak.
    console.error(`[epost] Feil ved sending til ${til}:`, e);
  }
}

/* ── Mal ──────────────────────────────────────────────────────────────────────────────
 *
 * Fargene er den grafiske profilen. Skrift er en systemstack: e-postklienter laster ikke
 * webfonter (Gmail stripper @font-face), så Plus Jakarta Sans kan ikke brukes her.
 *
 * Mørk modus i e-post er IKKE som på web: Apple Mail/iOS respekterer media queryen, Gmail
 * web viser alltid lysvarianten (derfor er den dempet — papir, ikke knallhvitt), og Outlook
 * inverterer på egen hånd. Mønsteret er inline lys stil + klasse, og mørke overstyringer med
 * !important i <head> — inline-stiler vinner ellers alltid.
 *
 * Layout er tabeller, ikke flex/grid — Outlook rendrer med Word-motoren.
 */

const FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function ramme(innhold: string): string {
  return `<!DOCTYPE html>
<html lang="no">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<style>
  @media (prefers-color-scheme: dark) {
    .em-bg   { background:#0b1220 !important; }
    .em-card { background:#121b2c !important; border-color:#243146 !important; }
    .em-h    { color:#f0f4ff !important; }
    .em-p    { color:#c3d0e2 !important; }
    .em-foot { background:#0e1626 !important; border-color:#243146 !important; }
    .em-link { color:#00c2ff !important; }
  }
</style>
</head>
<body class="em-bg" style="margin:0;padding:24px 16px;background:#fafbff;font-family:${FONT};">
  <div class="em-card" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
    <div style="background:#0d1b2a;padding:18px 28px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="width:28px;height:28px;border-radius:8px;background:#1459e0;background-image:linear-gradient(135deg,#1459e0,#00c2ff);text-align:center;vertical-align:middle;">
          <span style="color:#ffffff;font-size:12px;font-weight:800;letter-spacing:-0.5px;font-family:${FONT};">IQ</span>
        </td>
        <td style="padding-left:10px;">
          <span style="color:#ffffff;font-size:19px;font-weight:700;letter-spacing:-0.5px;font-family:${FONT};">Drift<span style="color:#00c2ff;">IQ</span></span>
        </td>
      </tr></table>
    </div>
    <div style="padding:28px;">${innhold}</div>
    <div class="em-foot" style="padding:16px 28px;background:#f0f4ff;border-top:1px solid #e2e8f0;font-size:11px;color:#8892a4;text-align:center;">
      DriftIQ &mdash; Forvaltning av borettslag og sameier &nbsp;|&nbsp;
      <a href="${APP_URL}" class="em-link" style="color:#1459e0;text-decoration:none;">${APP_URL}</a>
    </div>
  </div>
</body>
</html>`;
}

/** Blå på både lys og mørk flate — trenger ingen mørk overstyring. */
const knapp = (tekst: string, url: string) =>
  // Bunnmarg også: teksten som følger etter en knapp har `margin-top: 0`, og uten dette
  // klistrer den seg til knappen. E-postklienter kollapser ikke marginer likt som nettlesere.
  `<a href="${url}" style="display:inline-block;margin:16px 0 20px;padding:11px 22px;background:#1459e0;color:#ffffff;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;font-family:${FONT};">${tekst}</a>`;

const h = (tekst: string) =>
  `<h2 class="em-h" style="margin:0 0 16px;font-size:17px;font-weight:700;color:#0d1b2a;">${tekst}</h2>`;

const p = (tekst: string) =>
  `<p class="em-p" style="margin:0 0 12px;font-size:13px;color:#3d4a5c;line-height:1.6;">${tekst}</p>`;

/** Alt som kommer fra basen må escapes — et navn med «<» ville ellers brutt malen. */
function trygg(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const fornavn = (navn: string) => trygg(navn.trim().split(/\s+/)[0] ?? navn);

/* ── E-postene ─────────────────────────────────────────────────────────────────────── */

export async function sendPassordreset(navn: string, til: string, url: string): Promise<void> {
  await send(
    til,
    "Tilbakestill passord — DriftIQ",
    ramme(
      h("Tilbakestill passord") +
        p(`Hei ${fornavn(navn)},`) +
        p(
          "Vi mottok en forespørsel om å tilbakestille passordet ditt. Klikk på knappen " +
            "nedenfor for å velge et nytt. Lenken er gyldig i <strong>1 time</strong>.",
        ) +
        knapp("Tilbakestill passord", url) +
        p(
          "Ba du ikke om dette, kan du se bort fra e-posten. Passordet ditt forblir uendret.",
        ),
    ),
  );
}

/**
 * Velkomst til en ny bruker. Samme lenke som passordreset — kontoen har ikke noe passord
 * ennå, så «sett ditt» og «tilbakestill» er teknisk sett samme handling. Ordlyden er en
 * annen fordi situasjonen er det: du har aldri hatt et passord her.
 */
export async function sendKontooppsett(navn: string, til: string, url: string): Promise<void> {
  await send(
    til,
    "Velkommen til DriftIQ — sett opp kontoen din",
    ramme(
      h(`Velkommen til DriftIQ, ${fornavn(navn)}!`) +
        p(
          `Du har fått tilgang til DriftIQ med e-postadressen <strong>${trygg(til)}</strong>. ` +
            "Klikk på knappen nedenfor for å sette ditt eget passord.",
        ) +
        knapp("Sett passord", url) +
        p("Lenken er gyldig i 1 time. Utløper den, kan en administrator sende en ny."),
    ),
  );
}

/* ── Varsler fra den periodiske jobben ─────────────────────────────────────────────── */

const rad = (venstre: string, hoyre?: string) =>
  `<tr style="border-bottom:1px solid #e2e8f0;">` +
  `<td style="padding:8px 12px 8px 0;font-size:12px;font-weight:500;color:#0d1b2a;">${venstre}</td>` +
  (hoyre === undefined ? "" : `<td style="padding:8px 0;font-size:12px;color:#8892a4;">${hoyre}</td>`) +
  `</tr>`;

const tabell = (rader: string) =>
  `<table style="width:100%;border-collapse:collapse;margin:12px 0;">${rader}</table>`;

/**
 * Ukentlig sammendrag av ALLE forsinkede oppgaver i laget.
 *
 * Skiller seg fra den personlige varianten under ved at lista er hele lagets — dette går til
 * den som har bedt om oversikten, ikke til den som er ansvarlig.
 */
export async function sendForsinkedeOppgaver(
  orgNavn: string,
  til: string,
  oppgaver: Array<{ tittel: string; leverandor: string | null }>,
): Promise<void> {
  const antall = oppgaver.length;
  await send(
    til,
    `${antall} forsinkede oppgaver — ${orgNavn}`,
    ramme(
      h(`Forsinkede oppgaver — ${trygg(orgNavn)}`) +
        p(
          `${antall} oppgave${antall === 1 ? "" : "r"} i <strong>${trygg(orgNavn)}</strong> er ` +
            "forfalt og ikke utført:",
        ) +
        tabell(oppgaver.map((o) => rad(trygg(o.tittel), trygg(o.leverandor ?? "—"))).join("")) +
        knapp("Se alle oppgaver", `${APP_URL}/oppgaver`),
    ),
  );
}

/**
 * Personlig påminnelse til den som står som ansvarlig.
 *
 * Mykere innledning enn sammendraget over, og med vilje: dette er en påminnelse om ditt eget
 * ansvar, ikke en rapport om laget.
 */
export async function sendMineForsinkedeOppgaver(
  orgNavn: string,
  til: string,
  navn: string,
  oppgaver: Array<{ tittel: string; sted: string | null }>,
): Promise<void> {
  const antall = oppgaver.length;
  await send(
    til,
    `${antall} av dine oppgaver er forsinket — ${orgNavn}`,
    ramme(
      h(`${antall} av dine oppgaver er forsinket`) +
        p(
          `Hei ${fornavn(navn)}! Disse oppgavene i <strong>${trygg(orgNavn)}</strong> står som ` +
            "ditt ansvar og har passert fristen sin.",
        ) +
        tabell(
          oppgaver
            .map((o) =>
              rad(
                trygg(o.tittel) +
                  (o.sted ? `<br><span style="font-size:11px;color:#8892a4;">${trygg(o.sted)}</span>` : ""),
              ),
            )
            .join(""),
        ) +
        knapp("Se oppgavene", `${APP_URL}/oppgaver`),
    ),
  );
}

/** Kontrakter som nærmer seg utløp. Rødt under 30 dager — da haster reforhandlingen. */
export async function sendKontrakterUtloper(
  orgNavn: string,
  til: string,
  kontrakter: Array<{ tittel: string; leverandor: string | null; dagerIgjen: number }>,
): Promise<void> {
  const rader = kontrakter
    .map(
      (k) =>
        `<tr style="border-bottom:1px solid #e2e8f0;">` +
        `<td style="padding:8px 12px 8px 0;font-size:12px;font-weight:500;color:#0d1b2a;">${trygg(k.tittel)}</td>` +
        `<td style="padding:8px 12px 8px 0;font-size:12px;color:#8892a4;">${trygg(k.leverandor ?? "—")}</td>` +
        // #d97706 og ikke profilens amber: den har for lav kontrast mot hvitt som tekst.
        `<td style="padding:8px 0;font-size:12px;font-weight:600;color:${k.dagerIgjen <= 30 ? "#f04040" : "#d97706"};">${k.dagerIgjen} dager</td>` +
        `</tr>`,
    )
    .join("");

  await send(
    til,
    `Kontrakter utløper snart — ${orgNavn}`,
    ramme(
      h(`Kontrakter som snart utløper — ${trygg(orgNavn)}`) +
        p(`Følgende avtaler i <strong>${trygg(orgNavn)}</strong> nærmer seg utløpsdato:`) +
        tabell(rader) +
        knapp("Se kontrakter", `${APP_URL}/kontrakter`),
    ),
  );
}

/**
 * Varsel til DriftIQ om en ny henvendelse.
 *
 * Går til `LEADS_NOTIFY_EMAIL`. Er den ikke satt, logges det HØYT — en lead som ligger i
 * databasen uten at noen vet om den, er en tapt kunde, og stillhet er verste utfall.
 */
export async function sendNyLead(lead: {
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  message: string | null;
}): Promise<void> {
  const til = process.env.LEADS_NOTIFY_EMAIL;
  if (!til) {
    console.warn(
      `[leads] LEADS_NOTIFY_EMAIL er ikke satt — ingen varslet om «${lead.name}». ` +
        "Henvendelsen ligger i plattformpanelet.",
    );
    return;
  }

  const felt = (etikett: string, verdi: string) =>
    `<tr><td style="padding:6px 12px 6px 0;font-size:12px;color:#8892a4;white-space:nowrap;vertical-align:top;">${etikett}</td>` +
    `<td style="padding:6px 0;font-size:12px;color:#0d1b2a;font-weight:500;">${trygg(verdi)}</td></tr>`;

  await send(
    til,
    `Ny henvendelse: ${lead.name}`,
    ramme(
      h("Ny interessent fra landingssiden") +
        '<table style="margin:16px 0;border-collapse:collapse;width:100%;">' +
        felt("Navn", lead.name) +
        felt("E-post", lead.email) +
        felt("Telefon", lead.phone ?? "—") +
        felt("Borettslag/sameie", lead.company ?? "—") +
        felt("Melding", lead.message ?? "—") +
        "</table>" +
        knapp("Åpne plattformpanelet", `${APP_URL}/plattform/leads`),
    ),
  );
}

/** Varsel til DriftIQ om en ny innmelding. Samme innboks som leads. */
export async function sendNyFeilmelding(sak: {
  number: number | null;
  kind: string;
  module: string | null;
  description: string;
  reportedByName: string;
  reportedByEmail: string | null;
  appVersion: string | null;
}): Promise<void> {
  const til = process.env.LEADS_NOTIFY_EMAIL;
  if (!til) {
    console.warn(
      `[feilmelding] LEADS_NOTIFY_EMAIL er ikke satt — ingen varslet om FM-${String(sak.number ?? 0).padStart(4, "0")}. ` +
        "Saken ligger i plattformpanelet.",
    );
    return;
  }

  const nr = `FM-${String(sak.number ?? 0).padStart(4, "0")}`;
  const etikett = { bug: "Feil", idea: "Forslag", question: "Spørsmål" }[sak.kind] ?? sak.kind;
  const felt = (e: string, v: string) =>
    `<tr><td style="padding:6px 12px 6px 0;font-size:12px;color:#8892a4;white-space:nowrap;vertical-align:top;">${e}</td>` +
    `<td style="padding:6px 0;font-size:12px;color:#0d1b2a;font-weight:500;">${trygg(v)}</td></tr>`;

  await send(
    til,
    `${nr}: ${etikett} fra ${sak.reportedByName}`,
    ramme(
      h(`${etikett} meldt inn`) +
        '<table style="margin:16px 0;border-collapse:collapse;width:100%;">' +
        felt("Sak", nr) +
        felt("Modul", sak.module ?? "Ikke oppgitt") +
        felt("Meldt av", `${sak.reportedByName} (${sak.reportedByEmail ?? "ingen e-post"})`) +
        felt("Versjon", sak.appVersion ?? "—") +
        felt("Beskrivelse", sak.description) +
        "</table>" +
        knapp("Åpne i plattformpanelet", `${APP_URL}/plattform/saker`),
    ),
  );
}

/**
 * Svar til den som meldte fra.
 *
 * Beskrivelsen gjentas under svaret — de husker sjelden ordlyden i en sak de meldte for to
 * uker siden.
 */
export async function sendFeilmeldingSvar(
  sak: { number: number | null; description: string; reportedByEmail: string | null },
  svar: string,
): Promise<void> {
  if (!sak.reportedByEmail) return;
  const nr = `FM-${String(sak.number ?? 0).padStart(4, "0")}`;

  await send(
    sak.reportedByEmail,
    `Svar på din henvendelse (${nr})`,
    ramme(
      h("Svar på din henvendelse") +
        p(trygg(svar).replace(/\n/g, "<br>")) +
        '<table style="margin:20px 0 0;border-collapse:collapse;width:100%;">' +
        `<tr><td style="padding:6px 12px 6px 0;font-size:12px;color:#8892a4;white-space:nowrap;vertical-align:top;">Din sak</td>` +
        `<td style="padding:6px 0;font-size:12px;color:#0d1b2a;font-weight:500;">${nr}</td></tr>` +
        `<tr><td style="padding:6px 12px 6px 0;font-size:12px;color:#8892a4;white-space:nowrap;vertical-align:top;">Du skrev</td>` +
        `<td style="padding:6px 0;font-size:12px;color:#0d1b2a;font-weight:500;">${trygg(sak.description)}</td></tr>` +
        "</table>",
    ),
  );
}
