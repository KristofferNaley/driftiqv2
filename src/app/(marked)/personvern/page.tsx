import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Personvern — DriftIQ",
  description: "Hvilke opplysninger DriftIQ behandler, hvorfor, og hvor lenge.",
};

/**
 * Personvernerklæringen.
 *
 * Kort med vilje. En erklæring ingen leser fordi den er ti sider, oppfyller formkravet og
 * ikke formålet.
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
          å følge opp en mulig avtale — ingenting annet. Vi selger ikke opplysninger videre og
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
          dataene sine. Hva som lagres — brukerkontoer, avvik, oppgaver, enheter — styrer dere
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
