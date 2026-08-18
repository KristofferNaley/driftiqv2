import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Personvern – DriftIQ",
  description: "Hvilke opplysninger DriftIQ behandler, hvorfor, og hvor lenge.",
};

/**
 * Personvernerklæringen.
 *
 * Kort med vilje. En erklæring ingen leser fordi den er ti sider, oppfyller formkravet og
 * ikke formålet.
 *
 * «Webanalyse»-avsnittet er portert fra v1 og MÅ stå så lenge Umami er skrudd på (se
 * `src/components/Webanalyse.tsx`). Det er ikke en formalitet: setningen «vi bruker ingen
 * tredjeparts annonsenettverk» rett over er sann også med Umami, og uten avsnittet ville
 * siden ved første øyekast lest som at vi ikke måler noe i det hele tatt.
 */
export default function Personvern() {
  return (
    <main className="mk-seksjon smal">
      <span className="mk-overtittel">Personvern</span>
      <h1>Hvordan vi behandler opplysninger</h1>

      <div className="mk-tekst">
        <h2>Når du tar kontakt</h2>
        <p>
          Fyller du ut skjemaet på forsiden, lagrer vi navnet, e-postadressen og det du
          eventuelt skriver om telefon, borettslag og ærend. Det brukes til å svare deg og til
          å følge opp en mulig avtale, ingenting annet. Vi selger ikke opplysninger videre og
          bruker dem ikke til markedsføring mot andre.
        </p>
        <p>
          Vil du at vi sletter henvendelsen, er det bare å si fra på{" "}
          <a href="mailto:post@driftiq.no">post@driftiq.no</a>, så gjør vi det.
        </p>

        <h2>Når laget deres er kunde</h2>
        <p>
          Da er DriftIQ <strong>databehandler</strong> og borettslaget eller sameiet er
          behandlingsansvarlig. Vi behandler opplysningene på deres instruks, og de eier
          dataene sine. Hva som lagres (brukerkontoer, avvik, oppgaver, enheter) styrer dere
          selv gjennom bruken av systemet.
        </p>
        <p>
          Innsyn fra vår side i kundens data skjer bare i <strong>support-modus</strong>: en
          tidsbegrenset sesjon som krever en skriftlig begrunnelse, utløper automatisk, og
          logges med hvem, hvorfor og hvor lenge. Loggen er synlig i systemet.
        </p>

        <h2>Hvor dataene ligger</h2>
        <p>
          På servere i Norge. Vi bruker Resend til utsending av e-post, og de behandler kun
          mottakeradressen og innholdet i selve varselet.
        </p>
        <p>
          Nettsiden setter ingen sporingsinformasjonskapsler, og vi bruker ingen
          tredjeparts annonsenettverk.
        </p>

        <h2>Webanalyse</h2>
        <p>
          Vi bruker <strong>Umami</strong>, en selvhostet analyseløsning som kjører på vår
          egen server. Den setter <strong>ingen informasjonskapsler</strong>, lagrer ikke
          IP-adressen din, og følger deg ikke på tvers av nettsteder. Derfor finnes det
          heller ingen cookie-banner her. Det registreres kun aggregert statistikk: hvilke
          sider som besøkes, omtrentlig geografi på landnivå, nettlesertype og hvor besøket
          kom fra.
        </p>
        <p>
          Skriften på nettstedet lastes fra vår egen server, ikke fra en font-CDN, av samme
          grunn: et oppslag mot en tredjepart ville sendt IP-adressen din dit.
        </p>

        <h2>Dine rettigheter</h2>
        <p>
          Du har rett til innsyn, retting og sletting. Ta kontakt på{" "}
          <a href="mailto:post@driftiq.no">post@driftiq.no</a>, så ordner vi det. Mener du at
          vi behandler opplysninger feil, kan du klage til Datatilsynet.
        </p>
      </div>
    </main>
  );
}
