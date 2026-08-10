/**
 * Meldingen som ber en leverandør begynne å bruke QR-kvittering. **Ingen server-importer** —
 * teksten lages i nettleseren, og fila leses av en `"use client"`-komponent.
 *
 * ## Hvorfor dette er en funksjon og ikke en hjelpetekst i UI-et
 *
 * QR-oppslaget er verdiløst til noen faktisk skanner det. Det leddet er ikke teknisk, det er
 * en e-post et styremedlem må skrive til rørleggeren — og den e-posten blir enten aldri sendt,
 * eller den blir tre setninger som ikke sier hva leverandøren skal gjøre. Da henger koden der,
 * ubrukt, og loggen fylles av manuelle etterregistreringer i stedet.
 *
 * Så teksten er en del av produktet. Den er generert, ikke en mal med hakeparenteser man må
 * fylle ut: laget, leverandøren, oppgavene og kontaktpersonen står der ferdig utfylt, fordi
 * en mal med `[SETT INN OPPGAVE]` er en mal som blir sendt med `[SETT INN OPPGAVE]` i seg.
 *
 * ## Hva den sier, og hvorfor i denne rekkefølgen
 *
 * 1. **Hvorfor** — ett bygg, én logg. Uten en grunn leses endringen som merarbeid noen har
 *    funnet på.
 * 2. **Hva som endrer seg for DEM** — én setning. Alt annet er som før.
 * 3. **Hvilke oppgaver det gjelder**, med sted og frekvens. Leverandøren gjør ofte flere
 *    jobber for laget, og «skann koden» uten liste er et spørsmål tilbake.
 * 4. **Stegene**, nummerert. Inkludert at det ikke kreves innlogging, app eller passord —
 *    det er den vanligste innvendingen, og den er avklart før den rekker å bli stilt.
 * 5. **Avvik**, fordi det er halve verdien: en montør som ser noe galt har nå et sted å si det.
 * 6. **Hvem de spør.** En e-post uten avsender å svare til blir ikke fulgt opp.
 */

import { FREQ_ETIKETTER } from "./oppgaveregler";

export type Meldingsoppgave = {
  tittel: string;
  /** Enhet eller fritekstlokasjon — «sprinklerrommet». `null` når oppgaven ikke har sted. */
  sted: string | null;
  frekvens: string;
};

export type Melding = { emne: string; tekst: string };

/**
 * `kontaktFornavn` gir «Hei Bjarte,» i stedet for «Hei,». Bare fornavnet: en e-post til en
 * leverandør skal være høflig, ikke formell, og «Hei Bjarte Nilsen Hansen,» leses som et brev
 * fra en bank.
 */
export function lagLeverandormelding(inn: {
  orgNavn: string;
  leverandorNavn: string;
  kontaktFornavn?: string | null;
  oppgaver: ReadonlyArray<Meldingsoppgave>;
  avsender: { navn: string; epost: string | null; telefon?: string | null };
}): Melding {
  const { orgNavn, leverandorNavn, kontaktFornavn, oppgaver, avsender } = inn;
  const flere = oppgaver.length !== 1;

  const linjer: string[] = [
    kontaktFornavn?.trim() ? `Hei ${kontaktFornavn.trim()},` : "Hei,",
    "",
    `${orgNavn} har tatt i bruk DriftIQ for å dokumentere drift og vedlikehold av bygget. ` +
      `For jobbene ${leverandorNavn} utfører for oss betyr det én endring — og bare én.`,
    "",
    "Der jobben gjøres henger det nå et oppslag med en QR-kode. Skann koden når arbeidet er " +
      "utført, og fyll ut det som etterspørres. Da registreres jobben direkte hos oss, med " +
      "dato, hvem som utførte den og eventuelle merknader. Dere slipper å sende oss en " +
      "rapport i etterkant.",
  ];

  if (oppgaver.length > 0) {
    linjer.push(
      "",
      flere ? "Dette gjelder disse oppgavene:" : "Dette gjelder denne oppgaven:",
      ...oppgaver.map((o) => {
        // Sted og frekvens er det leverandøren trenger for å kjenne igjen jobben i sin egen
        // ordrebok. Mangler de, skal linja ikke få en tom parentes hengende etter seg.
        const detaljer = [o.sted?.trim(), FREQ_ETIKETTER[o.frekvens] ?? o.frekvens]
          .filter((d): d is string => Boolean(d))
          .join(" · ");
        return detaljer ? `- ${o.tittel} (${detaljer})` : `- ${o.tittel}`;
      }),
    );
  }

  linjer.push(
    "",
    "Slik gjør dere det:",
    "1. Skann QR-koden på oppslaget med kameraet på telefonen.",
    "2. Skriv inn navnet på den som utførte jobben.",
    "3. Huk av sjekkpunktene, og skriv en merknad hvis noe bør følges opp.",
    "4. Trykk send. Det kreves ingen innlogging, ingen app og ingen passord.",
    "",
    "Ser dere noe som er galt eller bør utbedres, meld det som avvik i samme skjema. Da " +
      "kommer det rett til styret, og dere har dokumentert at det ble sagt fra.",
    "",
    // Koden er unik per oppgave og trykt på arket. Blir arket flyttet eller kastet, mister
    // laget koblingen mellom jobben og loggen — derfor står dette eksplisitt.
    "Oppslaget skal henge der det er montert. QR-koden er unik for hver oppgave, så den kan " +
      "ikke flyttes til en annen installasjon.",
    "",
  );

  const kontaktlinje = [avsender.epost?.trim(), avsender.telefon?.trim()]
    .filter((d): d is string => Boolean(d))
    .join(" / ");
  linjer.push(
    kontaktlinje
      ? `Har dere spørsmål, ta kontakt med ${avsender.navn} (${kontaktlinje}).`
      : `Har dere spørsmål, ta kontakt med ${avsender.navn}.`,
    "",
    "Med vennlig hilsen",
    avsender.navn,
    orgNavn,
  );

  return {
    emne: `${orgNavn}: QR-kvittering for ${flere ? "oppgaver" : "oppgave"} utført hos oss`,
    tekst: linjer.join("\n"),
  };
}
