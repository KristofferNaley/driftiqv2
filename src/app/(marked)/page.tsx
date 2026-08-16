import type { LucideIcon } from "lucide-react";
import {
  Archive,
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  Check,
  FileText,
  LayoutDashboard,
  ListChecks,
  Shield,
  SquareParking,
  Wrench,
} from "lucide-react";
import { Kontaktskjema } from "./kontaktskjema";
import { APP_URL } from "@/lib/urler";

/**
 * Landingssiden.
 *
 * Teksten er ikke funnet på — den er testet mot ekte styrer, først i v1 og siden justert.
 * Skriv den ikke om for variasjonens skyld.
 *
 * ## Rekkefølgen er argumentet
 *
 * Problemet før produktet: et styre kjenner igjen «driften ligger i hodet på én person» før
 * de vet hva en modulliste er. Derfor kommer `#problem` foran `#moduler`, og «hvem står bak»
 * etterpå — historien lander først når leseren allerede har nikket til problemet.
 *
 * ## Fargetonene er navigasjon, ikke pynt
 *
 * Hvert kort bærer en `tone` som farger topplinje og ikonfelt. Åtte identiske grå bokser
 * leses som én flate og gir øyet ingenting å feste seg ved; en tone per modul gjør lista
 * skannbar. Tonene er de fem som allerede finnes i designsystemet — ingen nye farger
 * innføres for markedssidens skyld.
 */

type Tone = "blaa" | "cyan" | "gronn" | "gul" | "rod";

const PUNKTER: [string, string][] = [
  ["8 moduler", "styret faktisk bruker"],
  ["QR-kvittering", "fra leverandør på stedet"],
  ["Deres data", "eksporterbar når som helst"],
  ["Norsk", "laget av en styreleder, ikke et konsern"],
];

/**
 * Utgangspunktet, i tre trinn. Nummereringen er innhold og ikke pynt: den sier at dette er
 * ett problem som utvikler seg, ikke tre løsrevne irritasjoner.
 */
const PROBLEMER: { nr: string; tittel: string; tekst: string; tone: Tone }[] = [
  {
    nr: "01",
    tone: "rod",
    tittel: "Kunnskapen sitter i én person",
    tekst:
      "Avtaler, frister og hvem som fikser hva er noe styrelederen husker. Det er ikke noe " +
      "laget eier, og ingen kan overta vervet uten en lang overlevering.",
  },
  {
    nr: "02",
    tone: "gul",
    tittel: "Frister ingen har ansvaret for",
    tekst:
      "Serviceavtaler fornyes automatisk, kontroller glipper og oppsigelsesfrister løper ut. " +
      "Det oppdages først når fakturaen kommer, eller når noe har gått galt.",
  },
  {
    nr: "03",
    tone: "blaa",
    tittel: "Dokumentasjon som lages i etterkant",
    tekst:
      "Internkontrollen finnes ikke før den må finnes. Da skrives den kvelden før tilsynet, " +
      "av noen som ikke var med da arbeidet ble gjort.",
  },
];

const MODULER: { tittel: string; tekst: string; Ikon: LucideIcon; tone: Tone }[] = [
  {
    tittel: "Internkontroll og HMS",
    Ikon: Shield,
    tone: "blaa",
    tekst:
      "Risikovurdering, HMS-mål og vernerunde i én struktur, bygget rundt " +
      "internkontrollforskriften § 5. Dokumentasjonen samles mens arbeidet gjøres.",
  },
  {
    tittel: "Avvik",
    Ikon: AlertTriangle,
    tone: "rod",
    tekst:
      "Registrer det som er galt, med bilde, sted, ansvarlig og frist. Hvert avvik lukkes " +
      "med begrunnelse, så historikken tåler et forsikringsoppgjør.",
  },
  {
    tittel: "Oppgaver med dokumentert utførelse",
    Ikon: ListChecks,
    tone: "gronn",
    tekst:
      "Faste rutiner med frist og ansvarlig. Leverandøren skanner en QR-kode på stedet og " +
      "kvitterer for utført arbeid, så styret slipper å ta noen på ordet.",
  },
  {
    tittel: "Vedlikeholdsplan",
    Ikon: Wrench,
    tone: "cyan",
    tekst:
      "Bygningsdeler med tilstandsgrad, tidslinje for tiltak og budsjettbehov per " +
      "femårsperiode. Et behov som er dokumentert og priset er lettere å få vedtatt.",
  },
  {
    tittel: "Kontrakter",
    Ikon: FileText,
    tone: "gul",
    tekst:
      "Alle leverandøravtaler med utløpsdato, og varsel før de fornyes automatisk eller " +
      "oppsigelsesfristen løper ut.",
  },
  {
    tittel: "Dokumentarkiv",
    Ikon: Archive,
    tone: "blaa",
    tekst:
      "Vedtekter, protokoller, tegninger og rapporter på ett sted, også når styret byttes ut.",
  },
  {
    tittel: "Årshjul",
    Ikon: CalendarDays,
    tone: "cyan",
    tekst:
      "Faste hendelser, frister og oppgaver fordelt gjennom året, så alt ikke havner i mai.",
  },
  {
    tittel: "Parkering",
    Ikon: SquareParking,
    tone: "gronn",
    tekst:
      "Plasser, hvem som disponerer dem, utleieavtaler og venteliste, med ladeplasser " +
      "skilt ut.",
  },
];

/** Hva et pilotlag faktisk går med på. Uttalt, fordi «ta kontakt» alene er en risiko. */
const STEG = [
  {
    tittel: "Dere sender en henvendelse",
    tekst: "Uforpliktende, og dere hører fra meg direkte, ikke fra en selger.",
  },
  {
    tittel: "Vi går gjennom systemet sammen",
    tekst: "Jeg viser det med deres eget bygg som eksempel, og vi bruker den tiden dere trenger.",
  },
  {
    tittel: "Oppsett er inkludert",
    tekst: "Dere starter ikke med et tomt system.",
  },
];

/* Menypunktene i produktbildet. Tallet er antallet som krever noe av styret akkurat nå —
   det er dét som gjør bildet til et system i drift og ikke en tom skjerm. */
const MOCK_MENY: { navn: string; Ikon: LucideIcon; antall?: string }[] = [
  { navn: "Dashboard", Ikon: LayoutDashboard },
  { navn: "Oppgaver", Ikon: ListChecks, antall: "1" },
  { navn: "Avvik", Ikon: AlertTriangle, antall: "1" },
  { navn: "Internkontroll", Ikon: Shield },
  { navn: "Kontrakter", Ikon: FileText },
  { navn: "Vedlikeholdsplan", Ikon: Wrench },
  { navn: "Årshjul", Ikon: CalendarDays },
  { navn: "Dokumentarkiv", Ikon: Archive },
];

const MOCK_TALL: [string, string, Tone][] = [
  ["Oppgaver", "15", "blaa"],
  ["À jour", "13", "gronn"],
  ["Forsinket", "1", "gul"],
  ["Åpne avvik", "1", "rod"],
];

const MOCK_LISTE: [string, string, string, Tone][] = [
  ["Ukentlig renhold fellesarealer", "Renholdsfirma · ukentlig", "À jour", "gronn"],
  ["Vindusvask fellesarealer", "Renholdsfirma · kvartalsvis", "Forsinket", "gul"],
  ["Årlig sjekk av avtrekksvifter", "Vaktmesterfirma · årlig", "À jour", "gronn"],
  ["Kontroll av brannslokkere", "Brannvernfirma · årlig", "À jour", "gronn"],
  ["Lekkasje i garasje, plass 12", "Avvik · meldt via QR-kode 14.08", "Åpent", "rod"],
];

export default function Landing() {
  return (
    <main>
      <section className="mk-hero">
        <span className="mk-merkelapp">
          I daglig drift i et borettslag i Bergen · tar inn pilotlag i høst
        </span>
        <h1>
          Driften av bygget trenger ikke ligge i hodet på <em>styrelederen</em>.
        </h1>
        <p className="mk-ingress">
          DriftIQ samler oppgaver, avvik, internkontroll, vedlikeholdsplan og dokumentasjon på
          ett sted, slik at historikken følger bygget og ikke personen som tilfeldigvis sitter i
          styret.
        </p>
        <div className="mk-knapper">
          <a className="mk-knapp" href="#kontakt">
            Bli pilotlag
            <ArrowRight size={17} aria-hidden />
          </a>
          <a className="mk-knapp sekundaer" href="#skjerm">Se hvordan det ser ut</a>
        </div>
        <p className="mk-liten">
          Uforpliktende. Du får svar fra meg direkte, normalt innen én virkedag.
        </p>
        <ul className="mk-punkter">
          {PUNKTER.map(([sterk, resten]) => (
            <li key={sterk}>
              <b>{sterk}</b> {resten}
            </li>
          ))}
        </ul>
      </section>

      {/* Et glimt av systemet. Bevisst en HTML-mock og ikke et skjermbilde: et bilde blir
          utdatert i det UI-et endres, og det gjør det ofte. Denne følger designtokenene og
          blir aldri feil på samme måte.

          Tallene viser et lag som stort sett er à jour, med ett avvik og én forsinket
          oppgave. Et dashbord fullt av rødt leser som kaos, ikke som et system som virker —
          førsteinntrykket skal være kontroll med varsling. */}
      <section className="mk-seksjon" id="skjerm">
        <div className="mk-skjerm" aria-hidden>
          <div className="mk-skjerm-topp">
            <span className="mk-prikker"><i /><i /><i /></span>
            <span className="mk-url">app.driftiq.no/dashboard</span>
          </div>
          <div className="mk-app">
            <aside className="mk-app-meny">
              <span className="mk-app-lbl">Moduler</span>
              {MOCK_MENY.map(({ navn, Ikon, antall }, i) => (
                <span key={navn} className={i === 0 ? "pa" : undefined}>
                  <Ikon size={13} aria-hidden />
                  {navn}
                  {antall && <i className="mk-app-merke">{antall}</i>}
                </span>
              ))}
            </aside>
            <div className="mk-app-innhold">
              <div className="mk-app-tittel">
                Fjellsiden Borettslag
                <em>Oversikt · uke 34</em>
              </div>
              <div className="mk-app-tall">
                {MOCK_TALL.map(([merkelapp, tall, tone]) => (
                  <div key={merkelapp} className={`t-${tone}`}>
                    <span>{merkelapp}</span>
                    <b>{tall}</b>
                  </div>
                ))}
              </div>
              <div className="mk-app-liste">
                {MOCK_LISTE.map(([tittel, meta, status, tone]) => (
                  <div key={tittel}>
                    <span>
                      <b>{tittel}</b>
                      <em>{meta}</em>
                    </span>
                    <span className={`mk-app-status t-${tone}`}>{status}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mk-band dyp" id="problem">
        <div className="mk-seksjon">
          <span className="mk-overtittel">Utgangspunktet</span>
          <h2>Et styre arver sjelden noe annet enn en perm og et telefonnummer</h2>
          <p className="mk-sek-ingress">
            Driften fungerer så lenge én person husker den. Det er den personen som ikke kan
            gå av.
          </p>
          <div className="mk-prob">
            {PROBLEMER.map((p) => (
              <article key={p.nr} className={`mk-prob-kort t-${p.tone}`}>
                <span className="mk-nr">{p.nr}</span>
                <h3>{p.tittel}</h3>
                <p>{p.tekst}</p>
              </article>
            ))}
          </div>
          <p className="mk-utgang">
            <Check size={18} aria-hidden />
            <span>
              DriftIQ flytter alt dette fra hodet til bygget. Neste styre overtar et system,
              ikke en muntlig gjennomgang.
            </span>
          </p>
        </div>
      </section>

      <section className="mk-band" id="moduler">
        <div className="mk-seksjon">
          <span className="mk-overtittel">Hva systemet dekker</span>
          <h2>Alt styret er ansvarlig for, samlet på ett sted</h2>
          <p className="mk-sek-ingress">
            Åtte moduler som henger sammen. Et avvik blir til en oppgave, oppgaven kvitteres av
            leverandøren, og kvitteringen blir dokumentasjon i internkontrollen.
          </p>
          <div className="mk-rutenett">
            {MODULER.map(({ tittel, tekst, Ikon, tone }) => (
              <article key={tittel} className={`mk-kort t-${tone}`}>
                <span className="mk-ikon" aria-hidden>
                  <Ikon size={17} />
                </span>
                <h3>{tittel}</h3>
                <p>{tekst}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Historien er salgsargumentet: et styre kjøper ikke fra «en utvikler i Bergen», de
          kjøper fra en styreleder med samme problem som dem. Derfor egen seksjon med navn og
          rolle, ikke en bisetning i ingressen. */}
      <section className="mk-band tonet" id="hvem">
        <div className="mk-seksjon smal">
          <div className="mk-person">
            <span className="mk-person-bilde" aria-hidden>KN</span>
            <span className="mk-person-info">
              <b>Kristoffer Naley Nornes</b>
              <em>Styreleder i et borettslag i Bergen</em>
              <span>Bruker DriftIQ i eget lag hver uke</span>
            </span>
          </div>
          <span className="mk-overtittel">Hvem står bak</span>
          <h2>Laget av noen som sitter i styret selv</h2>
          <p className="mk-ingress">
            Jeg er styreleder i et borettslag i Bergen, og jeg bygde DriftIQ til mitt eget lag
            først. Hver modul finnes fordi noe konkret gikk galt eller tok for lang tid hos
            oss: avtaler ingen fant, frister ingen eide, dokumentasjon som ble skrevet i
            etterkant. Systemet er i daglig drift der, og jeg bruker det selv hver uke.
          </p>
        </div>
      </section>

      <section className="mk-band dyp" id="kontakt">
        <div className="mk-seksjon">
          <div className="mk-cta">
            <div>
              <span className="mk-overtittel">Pilot høsten 2026</span>
              <h2>Vil dere være pilotlag?</h2>
              <p className="mk-sek-ingress">
                Jeg tar inn et lite antall borettslag og sameier i høst: styrer som vil være med
                å forme hvordan dette fungerer i praksis. Send en henvendelse, så tar vi det
                derfra.
              </p>
              <ol className="mk-steg">
                {STEG.map((s, i) => (
                  <li key={s.tittel}>
                    <span className="mk-steg-nr" aria-hidden>{i + 1}</span>
                    <span>
                      <b>{s.tittel}</b>
                      <em>{s.tekst}</em>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
            <Kontaktskjema />
          </div>
        </div>
      </section>

      <section className="mk-seksjon smal">
        <p className="mk-liten">
          Allerede kunde? <a href={`${APP_URL}/logg-inn`}>Logg inn her</a>.
        </p>
      </section>
    </main>
  );
}
