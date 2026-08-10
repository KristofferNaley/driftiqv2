import { Kontaktskjema } from "./kontaktskjema";
import { APP_URL } from "@/lib/urler";

/**
 * Landingssiden.
 *
 * Innholdet er hentet fra v1s landingsside, ikke funnet på: teksten er testet mot ekte
 * styrer, og en omskriving her ville vært å kaste den lærdommen.
 */

const MODULER = [
  {
    tittel: "Internkontroll og HMS",
    tekst:
      "Risikovurdering, HMS-mål og vernerunde i én struktur, bygget rundt " +
      "internkontrollforskriften § 5. Dokumentasjonen samles etter hvert som arbeidet " +
      "gjøres, ikke kvelden før tilsynet.",
  },
  {
    tittel: "Avvik",
    tekst:
      "Styret registrerer det som er galt, med bilde, sted, ansvarlig og frist. Hvert avvik " +
      "lukkes med begrunnelse, så historikken tåler et forsikringsoppgjør.",
  },
  {
    tittel: "Oppgaver og dokumentert utførelse",
    tekst:
      "Faste rutiner med frist og ansvarlig. Leverandøren skanner en QR-kode på stedet og " +
      "kvitterer for utført arbeid, så styret slipper å ta noen på ordet.",
  },
  {
    tittel: "Vedlikeholdsplan",
    tekst:
      "Bygningsdeler med tilstandsgrad, tidslinje for tiltak og budsjettbehov per " +
      "femårsperiode. Et behov som er dokumentert og priset er lettere å få vedtatt.",
  },
  {
    tittel: "Kontrakter",
    tekst:
      "Alle leverandøravtaler med utløpsdato og varsel før de fornyes automatisk eller " +
      "oppsigelsesfristen løper ut.",
  },
  {
    tittel: "Dokumentarkiv",
    tekst:
      "Vedtekter, protokoller, tegninger og rapporter på ett sted, også når styret byttes ut.",
  },
  {
    tittel: "Årshjul",
    tekst:
      "Faste hendelser, frister og oppgaver fordelt gjennom året, så alt ikke havner i mai.",
  },
  {
    tittel: "Parkering",
    tekst:
      "Plasser, hvem som disponerer dem, utleieavtaler og venteliste, med ladeplasser " +
      "skilt ut.",
  },
];

export default function Landing() {
  return (
    <main>
      <section className="mk-hero">
        <span className="mk-merkelapp">I drift · tar inn pilotlag i høst</span>
        <h1>
          Driften av bygget skal ikke ligge i hodet på <em>styrelederen</em>.
        </h1>
        <p className="mk-ingress">
          DriftIQ samler oppgaver, avvik, internkontroll, vedlikeholdsplan og dokumentasjon på
          ett sted, slik at historikken følger bygget og ikke personen som tilfeldigvis satt i
          styret. Jeg bygde systemet som styreleder i mitt eget borettslag i Bergen, der det er
          i daglig drift.
        </p>
        <div className="mk-knapper">
          <a className="mk-knapp" href="#kontakt">Bli pilotlag</a>
          <a className="mk-knapp sekundaer" href="#moduler">Se hva systemet gjør</a>
        </div>
        <p className="mk-liten">
          Uforpliktende. Du får svar fra meg direkte, normalt innen én virkedag.
        </p>
      </section>

      {/* Et glimt av systemet. Bevisst en HTML-mock og ikke et skjermbilde: et bilde blir
          utdatert i det UI-et endres, og det gjør det ofte. Denne følger designtokenene og
          blir aldri feil på samme måte.

          Tallene viser et lag som stort sett er à jour, med ett avvik og én forsinket
          oppgave. Et dashbord fullt av rødt leser som kaos, ikke som et system som virker —
          førsteinntrykket skal være kontroll med varsling. */}
      <section className="mk-seksjon">
        <span className="mk-overtittel">Et glimt av systemet</span>
        <h2>Slik ser det ut i praksis</h2>
        <div className="mk-skjerm" aria-hidden>
          <div className="mk-skjerm-topp">
            <span className="mk-prikker"><i /><i /><i /></span>
            <span className="mk-url">app.driftiq.no/dashboard</span>
          </div>
          <div className="mk-app">
            <aside className="mk-app-meny">
              <span className="mk-app-lbl">Moduler</span>
              {["Dashboard", "Oppgaver", "Avvik", "Internkontroll", "Kontrakter", "Vedlikeholdsplan", "Årshjul", "Dokumentarkiv"].map((m, i) => (
                <span key={m} className={i === 0 ? "pa" : undefined}>{m}</span>
              ))}
            </aside>
            <div className="mk-app-innhold">
              <div className="mk-app-tittel">Fjellsiden Borettslag</div>
              <div className="mk-app-tall">
                <div><b>15</b><span>Oppgaver</span></div>
                <div><b className="gronn">13</b><span>À jour</span></div>
                <div><b className="gul">1</b><span>Forsinket</span></div>
                <div><b className="rod">1</b><span>Åpent avvik</span></div>
              </div>
              <div className="mk-app-liste">
                {[
                  ["Ukentlig renhold fellesarealer", "Renholdsfirma · Ukentlig", "À jour", "gronn"],
                  ["Vindusvask fellesarealer", "Renholdsfirma · Kvartalsvis", "Forsinket", "gul"],
                  ["Årlig sjekk av avtrekksvifter", "Vaktmesterfirma · Årlig", "À jour", "gronn"],
                  ["Kontroll av brannslokkere", "Brannvernfirma · Årlig", "À jour", "gronn"],
                ].map(([tittel, meta, status, farge]) => (
                  <div key={tittel}>
                    <span>
                      <b>{tittel}</b>
                      <em>{meta}</em>
                    </span>
                    <span className={`mk-app-status ${farge}`}>{status}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Historien er salgsargumentet: et styre kjøper ikke fra «en utvikler i Bergen», de
          kjøper fra en styreleder med samme problem som dem. Derfor egen seksjon med navn og
          rolle, ikke en bisetning i ingressen. */}
      <section className="mk-seksjon smal" id="hvem">
        <span className="mk-overtittel">Hvem står bak</span>
        <h2>Bygget av en styreleder som ikke fikk gått av</h2>
        <div className="mk-person">
          <span className="mk-person-bilde" aria-hidden>KN</span>
          <span className="mk-person-info">
            <b>Kristoffer Naley Nornes</b>
            <em>Styreleder i et borettslag i Bergen</em>
          </span>
        </div>
        <p className="mk-ingress">
          DriftIQ ble til av et konkret problem: driften av bygget satt i hodet mitt. Avtaler,
          frister, historikk og hvem som fikser hva var ting jeg husket, ikke noe laget eide,
          og ingen kunne ta over vervet uten meg. DriftIQ er systemet jeg bygde for å kunne gå
          av, og det er i daglig drift i mitt eget lag.
        </p>
      </section>

      <section className="mk-seksjon" id="moduler">
        <span className="mk-overtittel">Hva systemet dekker</span>
        <h2>Alt styret er ansvarlig for, samlet på ett sted</h2>
        <div className="mk-rutenett">
          {MODULER.map((m) => (
            <article key={m.tittel} className="mk-kort">
              <h3>{m.tittel}</h3>
              <p>{m.tekst}</p>
            </article>
          ))}
        </div>
      </section>

      {/* Bussinnvendingen, besvart uoppfordret. Spørsmålet kommer i hvert styremøte der en
          enmannsbedrift skal vedtas, og et svar i klartekst snur innvendingen til et
          argument. */}
      <section className="mk-seksjon smal">
        <span className="mk-overtittel">Dataeierskap</span>
        <h2>Hva skjer hvis DriftIQ forsvinner?</h2>
        <p className="mk-ingress">
          Spørsmålet kommer i hvert styremøte der en liten leverandør skal vedtas, så her er
          svaret før dere spør: dataene er lagets, ikke mine. Velger dere å gå, eller skulle
          DriftIQ legges ned, får dere alt utlevert i formater dere kan ta med videre:
          dokumenter, avvik, oppgavehistorikk og vedlikeholdsplan. Poenget med systemet er at
          driften følger bygget, og det gjelder også overfor leverandøren av systemet.
        </p>
      </section>

      <section className="mk-seksjon smal" id="kontakt">
        <span className="mk-overtittel">Pilot høsten 2026</span>
        <h2>Vil dere være pilotlag?</h2>
        <p className="mk-ingress">
          Jeg tar inn et lite antall borettslag og sameier i høst: styrer som vil være med å
          forme hvordan dette fungerer i praksis. Send en henvendelse, så avtaler vi en
          20 minutters gjennomgang der jeg viser systemet med deres eget bygg som eksempel.
          Oppsett av bygget er inkludert, dere starter ikke med et tomt system.
        </p>
        <Kontaktskjema />
      </section>

      <section className="mk-seksjon smal">
        <p className="mk-liten">
          Allerede kunde? <a href={`${APP_URL}/logg-inn`}>Logg inn her</a>.
        </p>
      </section>
    </main>
  );
}
