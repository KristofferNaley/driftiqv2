"use client";

import { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { useOkt } from "@/components/OktProvider";
import { Feil, Tom, dagerSiden, initialer, siden, useOrgData } from "@/components/felles";
import { Bryter, Fanemodal, type Fanevalg, Knapperad, Modal, Tekstfelt, useSending } from "@/components/skjema";
import { Bell, KeyRound, Settings, User } from "lucide-react";
import { VARSLER, VARSEL_STANDARD } from "@/lib/varselvalg";
import { brreg, brukere, type OrgBruker, type StyreSvar } from "@/lib/klient";
import { formatOrgNr } from "@/lib/orgnr";
// FRA lib/nivaer.ts, ikke lib/brukere.ts: sistnevnte importerer databaseklienten, og en
// klientkomponent som rører den drar hele pg-driveren inn i nettleserbundlet. Bygget feiler
// da med «Can't resolve 'dns'» — og verken tsc eller lint sier fra på forhånd.
import { TILGANGSNIVAER, type Nivaa } from "@/lib/nivaer";

/** Titler som dekker de aller fleste. Fritekst er fortsatt lov — feltet er beskrivende. */
const VANLIGE_TITLER = ["Styreleder", "Styremedlem", "Varamedlem", "Forretningsfører", "Vaktmester"];

/**
 * Brukere og tilgang.
 *
 * Tilgangen ligger på MEDLEMSKAPET, ikke på kontoen: samme person kan være kontoadmin her og
 * ha visningstilgang i et annet lag. «Fjern tilgang» tar bort tilgangen til DENNE org-en —
 * kontoen består, og personen kan fortsatt logge inn og se sine andre lag.
 *
 * ## To ulike krav på denne siden
 *
 * Å OPPRETTE brukere krever bare `redigering`: HMS-ansvaret ligger ofte hos et styremedlem
 * som må lage kontoer selv. Å ENDRE en eksisterende bruker krever `orgadmin` — derfor er
 * raden bare klikkbar på `erAdmin`, mens knappene i toppen står på `kanOpprette`.
 */
export default function Brukere() {
  const { aktivOrg, bruker: innlogget } = useOkt();
  const { data, feil, setFeil, laster, last, orgId } = useOrgData((o) => brukere.liste(o));
  // Ett startsteg, ikke to knapper: `null` = lukket, ellers hvilket steg modalen åpner på.
  const [legger, setLegger] = useState<Steg | null>(null);
  const [redigerer, setRedigerer] = useState<OrgBruker | null>(null);

  const liste = data ?? [];
  const erAdmin = aktivOrg?.nivaa === "orgadmin";
  const kanOpprette = erAdmin || aktivOrg?.nivaa === "redigering";

  return (
    <Layout
      tittel="Brukere"
      handlinger={
        kanOpprette && (
          <button
            className="btn btn-primary"
            onClick={() => setLegger("velg")}
            aria-label="Legg til bruker"
          >
            ＋<span className="skjul-mobil"> Legg til bruker</span>
          </button>
        )
      }
    >
      <div className="page-content">
        <Feil melding={feil} />

        {/* Er du alene i lista, er manuell innmating det åpenbare valget — og det er nettopp
            da importen sparer mest. Boksen forsvinner så snart noen andre er lagt inn. */}
        {!laster && kanOpprette && liste.length <= 1 && (
          <div className="tips-stripe">
            <span style={{ fontSize: "var(--fs-sm)", lineHeight: 1.5, flex: "1 1 260px" }}>
              <b>Slipp å skrive inn styret manuelt.</b>{" "}
              <span style={{ color: "var(--muted)" }}>
                Hent styreleder, styremedlemmer og varamedlemmer rett fra Enhetsregisteret — du
                legger bare inn e-post.
              </span>
            </span>
            <button className="btn btn-primary" onClick={() => setLegger("brreg")}>
              Hent styret →
            </button>
          </div>
        )}

        <div className="card">
          <div className="bruker-hode">
            <span>Bruker</span>
            <span className="kol-vekk">Tittel</span>
            <span>Tilgangsnivå</span>
            <span className="kol-vekk">Sist innlogget</span>
            <span />
          </div>

          {laster ? (
            <Tom tekst="Henter …" />
          ) : liste.length === 0 ? (
            <Tom tekst="Ingen brukere har tilgang til denne organisasjonen ennå." />
          ) : (
            liste.map((b) => <Rad key={b.id} bruker={b} erAdmin={erAdmin} onEndre={setRedigerer} />)
          )}
        </div>

        {liste.length > 0 && (
          <div className="brukere-legend-foot">
            <b>Kontoadmin</b> er organisasjonens egen administrator og styrer i tillegg brukere,
            innstillinger og fakturering.
            {erAdmin
              ? " Nivået endres på personen med ⋯-knappen."
              : " Du har ikke det nivået her, så du kan se tilgangen, men ikke endre den."}
          </div>
        )}
      </div>

      {legger && (
        <LeggTilBruker
          startsteg={legger}
          orgId={orgId!}
          erAdmin={erAdmin}
          finnesFra={liste}
          onLukk={() => setLegger(null)}
          onLagret={last}
        />
      )}
      {redigerer && (
        <BrukerModal
          bruker={redigerer}
          orgId={orgId!}
          erMeg={redigerer.id === innlogget?.id}
          onLukk={() => setRedigerer(null)}
          onLagret={last}
          onFeil={setFeil}
        />
      )}
    </Layout>
  );
}

type Steg = "velg" | "brreg" | "manuelt";

/**
 * «Legg til bruker» — ett inngangspunkt, to veier videre.
 *
 * v1 hadde to knapper side om side i toppen («Hent styret fra Brønnøysund» og «＋ Ny
 * bruker»). Det tvinger et valg før man vet at det finnes et valg: importen er den raske
 * veien, men bare den som allerede kjenner den, trykker på den. Her er begge like synlige,
 * og importen står først fordi den er riktig svar for de fleste nye lag.
 */
function LeggTilBruker({
  startsteg,
  orgId,
  erAdmin,
  finnesFra,
  onLukk,
  onLagret,
}: {
  startsteg: Steg;
  orgId: string;
  erAdmin: boolean;
  finnesFra: OrgBruker[];
  onLukk: () => void;
  onLagret: () => Promise<void>;
}) {
  const [steg, setSteg] = useState<Steg>(startsteg);

  if (steg === "brreg") {
    return (
      <HentStyret
        orgId={orgId}
        erAdmin={erAdmin}
        finnesFra={finnesFra}
        onTilbake={() => setSteg("velg")}
        onLukk={onLukk}
        onLagret={onLagret}
      />
    );
  }
  if (steg === "manuelt") {
    return (
      <NyBrukerModal
        orgId={orgId}
        erAdmin={erAdmin}
        onTilbake={() => setSteg("velg")}
        onLukk={onLukk}
        onLagret={onLagret}
      />
    );
  }

  return (
    <Modal tittel="Legg til bruker" onLukk={onLukk}>
      <button type="button" className="valg-kort" onClick={() => setSteg("brreg")}>
        <span className="valg-ikon" aria-hidden>
          🏛
        </span>
        <span style={{ minWidth: 0 }}>
          <span className="valg-tittel">Hent styret fra Brønnøysund</span>
          <span className="valg-tekst">
            Henter styreleder, styremedlemmer og varamedlemmer fra Enhetsregisteret. Du legger
            bare inn e-post per person.
          </span>
        </span>
      </button>

      <button type="button" className="valg-kort" onClick={() => setSteg("manuelt")}>
        <span className="valg-ikon" aria-hidden>
          ＋
        </span>
        <span style={{ minWidth: 0 }}>
          <span className="valg-tittel">Legg til manuelt</span>
          <span className="valg-tekst">
            Én person av gangen — for vaktmester, forretningsfører og andre som ikke står i
            styret.
          </span>
        </span>
      </button>
    </Modal>
  );
}

function Rad({
  bruker: b,
  erAdmin,
  onEndre,
}: {
  bruker: OrgBruker;
  erAdmin: boolean;
  onEndre: (b: OrgBruker) => void;
}) {
  const tittel = (b.title ?? "").trim().toLowerCase();
  const tittelKlasse = tittel === "styreleder" ? " leder" : tittel === "varamedlem" ? " vara" : "";
  // Dempes når det er lenge siden — eller aldri. Et tall som er 200 dager gammelt skal ikke
  // konkurrere visuelt med et som er fra i dag.
  const dager = dagerSiden(b.lastLoginAt);
  const fjernt = dager === null || dager > 90;

  // Hele raden er knappen som åpner modalen — samme grep som risikoradene. ⋯-tegnet i
  // enden er ren pekepinn (et span, ikke en knapp: knapp-i-knapp er ugyldig HTML).
  const innhold = (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
        <span className="avatar" style={{ opacity: b.active ? 1 : 0.4 }}>
          {initialer(b.name)}
        </span>
        <div style={{ minWidth: 0 }}>
          <div className="list-tittel" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {b.name}
            {!b.active && " (inaktiv)"}
          </div>
          <div className="list-meta" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {b.email}
          </div>
        </div>
      </div>

      <span className={`title-badge${tittelKlasse} kol-vekk`}>{b.title || "—"}</span>

      <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
        <span className={`nivaa-badge ${b.nivaa}`}>
          <span className={`nivaa-prikk ${b.nivaa}`} />
          {TILGANGSNIVAER.find((n) => n.verdi === b.nivaa)?.etikett ?? b.nivaa}
        </span>
        {/* Invitasjonen står ute til brukeren har satt passord — ellers venter styret på
            noen som aldri har kommet inn. */}
        {!b.harSattPassord && <span className="badge warn">Ikke aktivert</span>}
      </div>

      {/* Vises åpent for alle i lista, ikke bare admin — feltet FINNES, og da skal ingen
          bruker bli overrasket over at det gjør det. */}
      <span
        className="kol-vekk"
        style={{ fontSize: "var(--fs-label)", color: fjernt ? "var(--muted)" : "var(--text)" }}
        title={b.lastLoginAt ? new Date(b.lastLoginAt).toLocaleString("nb-NO") : "Har aldri logget inn"}
      >
        {siden(b.lastLoginAt)}
      </span>

      {erAdmin ? (
        <span className="ikon-btn" aria-hidden>
          ⋯
        </span>
      ) : (
        <span />
      )}
    </>
  );

  return erAdmin ? (
    <button className="list-item bruker-rad klikkbar" onClick={() => onEndre(b)}>
      {innhold}
    </button>
  ) : (
    <div className="list-item bruker-rad">{innhold}</div>
  );
}

type Fane = "bruker" | "tilgang" | "varsler" | "konto";

/**
 * Tittelvalget — nedtrekk med «Annet …» som åpner fritekst. Én komponent for ny og
 * eksisterende bruker, så de to skjemaene ikke drifter fra hverandre.
 */
function TittelFelt({
  valg,
  onValg,
  egenTekst,
  onEgenTekst,
}: {
  valg: string;
  onValg: (v: string) => void;
  egenTekst: string;
  onEgenTekst: (v: string) => void;
}) {
  return (
    <div className="field">
      <label className="field-label" htmlFor="tittel">
        Tittel i organisasjonen
      </label>
      <select id="tittel" className="input" value={valg} onChange={(e) => onValg(e.target.value)}>
        <option value="">Ingen tittel</option>
        {VANLIGE_TITLER.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
        <option value="__egen__">Annet …</option>
      </select>
      {valg === "__egen__" && (
        <input
          className="input"
          style={{ marginTop: "8px" }}
          value={egenTekst}
          placeholder="Skriv tittelen"
          aria-label="Egen tittel"
          onChange={(e) => onEgenTekst(e.target.value)}
        />
      )}
      <div className="field-note">
        Ren beskrivelse. Fram til 08.08.2026 utledet v1 tilgang av tittelen — nå styrer den
        ingenting, og tilgangsnivået er det eneste som gjelder.
      </div>
    </div>
  );
}

/** Nivåkortene. Kort, ikke nedtrekk: beskrivelsen må være synlig NÅR man velger — ikke etterpå. */
function NivaaVelger({
  nivaa,
  onVelg,
  erAdmin,
}: {
  nivaa: Nivaa;
  onVelg: (n: Nivaa) => void;
  erAdmin: boolean;
}) {
  // Ingen kan dele ut et nivå de ikke har selv: en `redigering`-bruker som oppretter en konto
  // skal ikke kunne gjøre den til kontoadmin og logge inn som den. Håndheves i API-et — dette
  // er bare speilingen i UI-et.
  const valgbare = erAdmin ? TILGANGSNIVAER : TILGANGSNIVAER.filter((n) => n.verdi !== "orgadmin");
  return (
    <div className="field">
      <span className="field-label">Tilgangsnivå</span>
      {valgbare.map((n) => (
        <button
          key={n.verdi}
          type="button"
          className={`nivaa-kort${nivaa === n.verdi ? " valgt" : ""}`}
          onClick={() => onVelg(n.verdi)}
        >
          <span className="nivaa-radio" />
          <span style={{ minWidth: 0 }}>
            <span className="nivaa-navn">
              {n.etikett}
              <span className={`nivaa-prikk ${n.verdi}`} />
            </span>
            <span className="nivaa-desc">{n.beskrivelse}</span>
          </span>
        </button>
      ))}
      {!erAdmin && (
        <div className="field-note">Kontoadmin kan bare gis av en som selv er kontoadmin.</div>
      )}
    </div>
  );
}

/**
 * Ny bruker — vanlig modal med ETT skjema. Å opprette er fire felter og skal ikke gjemmes
 * bak faner; redigeringen har fanemodalen under.
 */
function NyBrukerModal({
  orgId,
  erAdmin,
  onLukk,
  onLagret,
  onTilbake,
}: {
  orgId: string;
  erAdmin: boolean;
  onLukk: () => void;
  onLagret: () => Promise<void>;
  /** Satt når modalen er nådd via valgsteget — da skal knappen gå ETT steg tilbake. */
  onTilbake?: () => void;
}) {
  const [navn, setNavn] = useState("");
  const [epost, setEpost] = useState("");
  const [nivaa, setNivaa] = useState<Nivaa>("redigering");
  const [tittelValg, setTittelValg] = useState("");
  const [egenTittelTekst, setEgenTittelTekst] = useState("");

  const { sender, feil, send } = useSending(async () => {
    await onLagret();
    onLukk();
  });

  const tittel = tittelValg === "__egen__" ? egenTittelTekst.trim() || null : tittelValg || null;

  return (
    <Modal tittel="Ny bruker" onLukk={onLukk}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(() =>
            brukere.inviter(orgId, { name: navn.trim(), email: epost.trim(), role: nivaa, title: tittel }),
          );
        }}
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
      >
        <Feil melding={feil} />

        <Tekstfelt etikett="Fullt navn *" verdi={navn} onEndre={setNavn} />
        <Tekstfelt
          etikett="E-postadresse *"
          type="email"
          verdi={epost}
          onEndre={setEpost}
          notat="Finnes adressen fra før, får den kontoen bare tilgang hit — én person skal ha én konto, ikke to."
        />
        <TittelFelt valg={tittelValg} onValg={setTittelValg} egenTekst={egenTittelTekst} onEgenTekst={setEgenTittelTekst} />
        <NivaaVelger nivaa={nivaa} onVelg={setNivaa} erAdmin={erAdmin} />

        <div className="field-note">
          Brukeren får en e-post med en engangslenke der de setter sitt eget passord. Du
          velger det ikke for dem — da ville to personer kjent det.
        </div>

        <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-ghost" onClick={onTilbake ?? onLukk}>
            {onTilbake ? "Tilbake" : "Avbryt"}
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={sender || !navn.trim() || !epost.trim()}
          >
            {sender ? "Oppretter …" : "Opprett bruker"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Rediger bruker — fanemodal med vertikale faner, samme form som «Min profil». Skuffen
 * (13.08.2026, formiddag) holdt ikke: med varsler, kontohandlinger og tofaktor ble den én
 * lang kolonne — nøyaktig formproblemet fanemodalen ble laget for. Én «Lagre» i bunnraden
 * skriver alt som er endret, uansett fane; prikkene i fanerekken viser hvor det ligger noe.
 *
 * ## To sperrer som speiles her og håndheves i API-et
 *
 * **Eget nivå:** raden man redigerer kan være en selv, og da er nivåvalget låst — en
 * kontoadmin som degraderer seg selv står i lesevisning i samme øyeblikk, og i verste fall
 * har kunden låst seg ute. En annen kontoadmin må gjøre det.
 *
 * **Tofaktor:** admin kan bare NULLSTILLE den (mistet telefon), aldri sette den opp — og
 * ikke sin egen herfra, for denne veien mangler passordbeviset profilen krever.
 */
function BrukerModal({
  bruker: b,
  orgId,
  erMeg,
  onLukk,
  onLagret,
  onFeil,
}: {
  bruker: OrgBruker;
  orgId: string;
  erMeg: boolean;
  onLukk: () => void;
  onLagret: () => Promise<void>;
  onFeil: (m: string) => void;
}) {
  const [fane, setFane] = useState<Fane>("bruker");

  const egenTittel = !!b.title && !VANLIGE_TITLER.includes(b.title);
  const [navn, setNavn] = useState(b.name);
  const [tittelValg, setTittelValg] = useState(egenTittel ? "__egen__" : (b.title ?? ""));
  const [egenTittelTekst, setEgenTittelTekst] = useState(egenTittel ? b.title! : "");
  const [nivaa, setNivaa] = useState<Nivaa>(b.nivaa as Nivaa);

  // Varslene ligger på medlemskapet og lagres for seg (eget endepunkt). Snapshotet av det
  // HENTEDE trengs for endret-prikken: med faner ser man ikke endringen man står bak.
  const [varsler, setVarsler] = useState<Record<string, boolean> | null>(null);
  const [varslerStart, setVarslerStart] = useState<Record<string, boolean> | null>(null);
  useEffect(() => {
    brukere
      .varsler(orgId, b.id)
      .then((r) => {
        const verdier = { ...VARSEL_STANDARD, ...r.prefs };
        setVarsler(verdier);
        setVarslerStart(verdier);
      })
      .catch(() => {
        setVarsler({ ...VARSEL_STANDARD });
        setVarslerStart({ ...VARSEL_STANDARD });
      });
  }, [orgId, b.id]);

  const [sendtOppsett, setSendtOppsett] = useState(false);
  const [bekrefterFjern, setBekrefterFjern] = useState(false);
  const [bekrefterTofaktor, setBekrefterTofaktor] = useState(false);
  const [tofaktorNullstilt, setTofaktorNullstilt] = useState(false);

  const { sender, feil, send } = useSending(async () => {
    await onLagret();
    onLukk();
  });

  const tittel = tittelValg === "__egen__" ? egenTittelTekst.trim() || null : tittelValg || null;
  const brukerEndret = navn.trim() !== b.name || tittel !== (b.title ?? null);
  const tilgangEndret = !erMeg && nivaa !== b.nivaa;
  const varslerEndret =
    varsler !== null &&
    varslerStart !== null &&
    VARSLER.some((v) => varsler[v.nokkel] !== varslerStart[v.nokkel]);

  async function lagre() {
    // Varslene har sitt eget endepunkt, så de skrives for seg. Rekkefølgen er med vilje:
    // feiler tilgangsendringen, skal varslene ikke allerede være lagret.
    await brukere.endre(orgId, b.id, {
      name: navn.trim(),
      // Eget nivå sendes ikke med: API-et avviser endringen uansett, og fanen har låst valget.
      role: erMeg ? undefined : nivaa,
      title: tittel,
    });
    if (varsler && varslerEndret) await brukere.settVarsler(orgId, b.id, varsler);
  }

  async function fjern() {
    try {
      await brukere.fjern(orgId, b.id);
      await onLagret();
      onLukk();
    } catch (e) {
      // «Organisasjonen må ha minst én administrator» kommer hit.
      onFeil(e instanceof Error ? e.message : "Kunne ikke fjerne tilgangen");
      onLukk();
    }
  }

  async function nullstillTofaktor() {
    try {
      await brukere.resettTofaktor(orgId, b.id);
      setTofaktorNullstilt(true);
      setBekrefterTofaktor(false);
      void onLagret();
    } catch (e) {
      onFeil(e instanceof Error ? e.message : "Kunne ikke nullstille tofaktor");
      setBekrefterTofaktor(false);
      onLukk();
    }
  }

  const faner: ReadonlyArray<Fanevalg<Fane>> = [
    { nokkel: "bruker", etikett: "Bruker", Ikon: User, endret: brukerEndret },
    { nokkel: "tilgang", etikett: "Tilgang", Ikon: KeyRound, endret: tilgangEndret },
    { nokkel: "varsler", etikett: "Varsler", Ikon: Bell, endret: varslerEndret },
    { nokkel: "konto", etikett: "Konto", Ikon: Settings },
  ];

  return (
    <>
      <Fanemodal
        tittel={b.name}
        onLukk={onLukk}
        faner={faner}
        valgt={fane}
        onVelg={setFane}
        fot={
          <div style={{ marginLeft: "auto", display: "flex", gap: "10px" }}>
            <button type="button" className="btn btn-ghost" onClick={onLukk}>
              Lukk
            </button>
            {/* Vanlig knapp, ikke `submit`: den står i bunnraden UTENFOR panelets skjema, og
                skal virke også fra en fane som ikke har noe skjema i seg. */}
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void send(lagre)}
              disabled={sender || !navn.trim() || !(brukerEndret || tilgangEndret || varslerEndret)}
            >
              {sender ? "Lagrer …" : "Lagre"}
            </button>
          </div>
        }
      >
        <Feil melding={feil} />

        {fane === "bruker" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(lagre);
            }}
            style={{ display: "flex", flexDirection: "column", gap: "15px" }}
          >
            <Tekstfelt etikett="Fullt navn *" verdi={navn} onEndre={setNavn} />
            {/* E-posten er innloggingsnøkkelen og kan ikke endres her. Feltet vises likevel —
                det er ofte det man leter etter når man åpner en bruker. */}
            <Tekstfelt
              etikett="E-postadresse"
              type="email"
              verdi={b.email}
              onEndre={() => {}}
              laast
              notat="E-post kan ikke endres"
            />
            <TittelFelt valg={tittelValg} onValg={setTittelValg} egenTekst={egenTittelTekst} onEgenTekst={setEgenTittelTekst} />
          </form>
        )}

        {fane === "tilgang" &&
          (erMeg ? (
            <div className="field">
              <span className="field-label">Tilgangsnivå</span>
              <span className={`nivaa-badge ${b.nivaa}`} style={{ alignSelf: "flex-start" }}>
                <span className={`nivaa-prikk ${b.nivaa}`} />
                {TILGANGSNIVAER.find((n) => n.verdi === b.nivaa)?.etikett ?? b.nivaa}
              </span>
              <div className="field-note">
                Ditt eget tilgangsnivå kan du ikke endre — da kunne laget stått uten kontoadmin
                uten at noen mente det. Be en annen kontoadmin gjøre det.
              </div>
            </div>
          ) : (
            <NivaaVelger nivaa={nivaa} onVelg={setNivaa} erAdmin />
          ))}

        {fane === "varsler" && (
          <div className="field">
            <div className="field-note" style={{ marginBottom: "6px" }}>
              Hvilke e-poster denne personen får, sendt til {b.email}. Hver enkelt kan også
              endre dette selv under Min profil.
            </div>
            {varsler === null ? (
              <div className="field-note">Henter …</div>
            ) : (
              VARSLER.map((v) => (
                <Bryter
                  key={v.nokkel}
                  etikett={v.etikett}
                  beskrivelse={v.beskrivelse}
                  verdi={varsler[v.nokkel] ?? false}
                  onEndre={(paa) => setVarsler({ ...varsler, [v.nokkel]: paa })}
                />
              ))
            )}
          </div>
        )}

        {fane === "konto" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "15px" }}>
            <div className="field">
              <span className="field-label">Kontohandlinger</span>
              <button
                type="button"
                className="btn btn-ghost profil-handling"
                disabled={sendtOppsett}
                onClick={() => {
                  // Svaret er alltid «sendt». Om adressen tar imot den, vet vi først når
                  // brukeren logger inn — å love mer enn det ville vært å lyve.
                  void brukere.sendOppsett(orgId, b.id).catch(() => {});
                  setSendtOppsett(true);
                }}
              >
                {sendtOppsett ? "E-post sendt" : b.harSattPassord ? "Send lenke for nytt passord" : "Send oppsett-e-post på nytt"}
              </button>
              <button
                type="button"
                className="btn btn-ghost profil-handling fjern-knapp"
                onClick={() => setBekrefterFjern(true)}
              >
                Fjern tilgang
              </button>
              {/* «Sett passord manuelt» fra v1 er bevisst IKKE portert: det lar en admin velge
                  passordet til en annen person, og da kjenner to personer det. Engangslenken
                  over gjør samme jobb uten den bieffekten. */}
            </div>

            <div className="field">
              <span className="field-label">Tofaktor</span>
              {erMeg ? (
                <div className="field-note">
                  Din egen tofaktor styrer du under Min profil — der bekreftes endringen med
                  passordet ditt.
                </div>
              ) : tofaktorNullstilt ? (
                <div className="field-note">
                  Tofaktor er nullstilt. {b.name} logger inn med bare passord og setter opp
                  tofaktor på nytt selv under Min profil.
                </div>
              ) : b.tofaktor ? (
                <>
                  <div className="field-note">
                    Tofaktor er på. Har {b.name} mistet telefonen, kan du nullstille den her —
                    innlogging krever da bare passord til tofaktor er satt opp på nytt. Du kan
                    bare fjerne sperren, aldri sette den opp for andre.
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost profil-handling"
                    onClick={() => setBekrefterTofaktor(true)}
                  >
                    Nullstill tofaktor
                  </button>
                </>
              ) : (
                <div className="field-note">
                  Ikke satt opp. Tofaktor er noe hver bruker slår på selv under Min profil — en
                  kontoadmin kan bare nullstille den, aldri sette den opp for andre.
                </div>
              )}
            </div>
          </div>
        )}
      </Fanemodal>

      {bekrefterFjern && (
        <Modal tittel="Fjern tilgang" onLukk={() => setBekrefterFjern(false)} bredde={380}>
          <p style={{ fontSize: "var(--fs-sm)", lineHeight: 1.6 }}>
            Fjern <strong>{b.name}</strong> sin tilgang til denne organisasjonen? Personen kan
            ikke lenger logge inn her.
          </p>
          <div className="tips-stripe" style={{ margin: "12px 0" }}>
            <span style={{ fontSize: "var(--fs-sm)", lineHeight: 1.6 }}>
              🛡 Kontoen slettes ikke. Sitter personen i flere styrer, beholder de tilgangen der —
              og alt de har kvittert ut her står igjen i historikken med navnet sitt.
            </span>
          </div>
          <Knapperad
            onAvbryt={() => setBekrefterFjern(false)}
            sendEtikett="Fjern tilgang"
            farlig
            onSend={() => void fjern()}
          />
        </Modal>
      )}

      {bekrefterTofaktor && (
        <Modal tittel="Nullstill tofaktor" onLukk={() => setBekrefterTofaktor(false)} bredde={380}>
          <p style={{ fontSize: "var(--fs-sm)", lineHeight: 1.6 }}>
            Nullstill tofaktor for <strong>{b.name}</strong>? Kontoen er da bare beskyttet av
            passordet fram til tofaktor er satt opp på nytt.
          </p>
          <div className="tips-stripe" style={{ margin: "12px 0" }}>
            <span style={{ fontSize: "var(--fs-sm)", lineHeight: 1.6 }}>
              🛡 Gjør dette bare når du vet hvem som spør — en oppringning om «mistet telefon»
              er også slik kontoer kapres.
            </span>
          </div>
          <Knapperad
            onAvbryt={() => setBekrefterTofaktor(false)}
            sendEtikett="Nullstill tofaktor"
            farlig
            onSend={() => void nullstillTofaktor()}
          />
        </Modal>
      )}
    </>
  );
}

const EPOST_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * FORHÅNDSVALGT nivå ut fra registerrollen — et forslag, ikke en regel.
 *
 * Forskjellen betyr noe. v1 viste et tilgangsmerke UTLEDET av rollen, uten mulighet til å
 * endre det, og det var misvisende: tittelen styrer ikke tilgang. Her er nivået et felt
 * admin ser og kan overstyre før noe opprettes — varamedlemmer trenger sjelden mer enn
 * lesetilgang, mens ansvaret i et styre ofte er delt slik at flere trenger kontoadmin.
 *
 * Ingen får `orgadmin` automatisk. Å gi bort nøklene til kontosidene skal være en handling
 * noen faktisk utfører, ikke noe som skjer fordi et register sier «Styreleder».
 */
function nivaaForRolle(rolle: string): Nivaa {
  return rolle === "Varamedlem" ? "visning" : "redigering";
}

/**
 * «Hent styret fra Brønnøysund» (BL-139).
 *
 * Slår opp styrerollene på lagets org.nr., lar admin fylle inn e-post per person, og
 * oppretter brukerne gjennom den vanlige invitasjonsflyten.
 *
 * ## To ting som er lette å gjøre feil her
 *
 * **Alle importerte får `redigering`** — ikke et nivå utledet av registerrollen. Tittelen
 * («Varamedlem», «Styreleder») er ren beskrivelse og styrer ingenting; å la den bestemme
 * tilgang ville gjenskapt nøyaktig det v1 kvittet seg med 08.08.2026.
 *
 * **Duplikatsjekken går på NAVN, ikke e-post** — registeret har ingen e-postadresser. Det er
 * godt nok til å forhåndsfjerne det åpenbare; API-et avviser uansett på e-post, så en glipp
 * her gir en feilmelding, ikke en dobbel bruker.
 */
function HentStyret({
  orgId,
  erAdmin,
  finnesFra,
  onLukk,
  onLagret,
  onTilbake,
}: {
  orgId: string;
  erAdmin: boolean;
  finnesFra: OrgBruker[];
  onLukk: () => void;
  onLagret: () => Promise<void>;
  onTilbake?: () => void;
}) {
  type Rad = {
    navn: string;
    rolle: string;
    epost: string;
    nivaa: Nivaa;
    med: boolean;
    finnes: boolean;
  };

  const [svar, setSvar] = useState<StyreSvar | null>(null);
  const [rader, setRader] = useState<Rad[]>([]);
  const [feil, setFeil] = useState<string | null>(null);
  const [sender, setSender] = useState(false);

  useEffect(() => {
    let avbrutt = false;
    brreg
      .styre(orgId)
      .then((r) => {
        if (avbrutt) return;
        setSvar(r);
        const tatt = new Set(finnesFra.map((u) => u.name.trim().toLowerCase()));
        setRader(
          r.styre.map((p) => {
            const finnes = tatt.has(p.navn.trim().toLowerCase());
            return { ...p, epost: "", nivaa: nivaaForRolle(p.rolle), med: !finnes, finnes };
          }),
        );
      })
      .catch((e) => {
        if (!avbrutt) setFeil(e instanceof Error ? e.message : "Kunne ikke hente styret");
      });
    return () => {
      avbrutt = true;
    };
    // `finnesFra` brukes KUN til førstegangsmatch. Står den i avhengighetene, kjører
    // oppslaget på nytt hver gang brukerlista endres — og den endres jo av oss, midt i
    // opprettelsen, slik at halvutfylte e-poster blir nullstilt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const settRad = (i: number, endring: Partial<Rad>) =>
    setRader((forrige) => forrige.map((r, j) => (j === i ? { ...r, ...endring } : r)));

  // Samme sperre som i brukermodalen: ingen deler ut et nivå de ikke har selv.
  const valgbareNivaer = erAdmin
    ? TILGANGSNIVAER
    : TILGANGSNIVAER.filter((n) => n.verdi !== "orgadmin");
  const valgte = rader.filter((r) => r.med && !r.finnes);
  const klare = valgte.filter((r) => EPOST_RE.test(r.epost.trim()));

  async function opprett() {
    setSender(true);
    setFeil(null);
    const feilet: string[] = [];
    // Én om gangen, ikke `Promise.all`: feiler én e-post, skal de andre likevel bli
    // opprettet — og raden som gikk gjennom må markeres, ellers lages den på nytt ved
    // neste forsøk.
    for (let i = 0; i < rader.length; i++) {
      const r = rader[i]!;
      if (!r.med || r.finnes || !EPOST_RE.test(r.epost.trim())) continue;
      try {
        await brukere.inviter(orgId, {
          name: r.navn,
          email: r.epost.trim(),
          role: r.nivaa,
          title: r.rolle,
        });
        settRad(i, { finnes: true, med: false });
      } catch (e) {
        feilet.push(`${r.navn}: ${e instanceof Error ? e.message : "feilet"}`);
      }
    }
    await onLagret();
    setSender(false);
    if (feilet.length) setFeil(feilet.join(" · "));
    else onLukk();
  }

  const nr = formatOrgNr(svar?.orgNr);

  return (
    <Modal tittel="Hent styret fra Brønnøysund" onLukk={onLukk} bredde={720}>
      {svar === null && !feil ? (
        <div className="field-note">Henter styret fra Enhetsregisteret …</div>
      ) : svar?.status === "mangler-orgnr" ? (
        <p style={{ fontSize: "var(--fs-sm)", lineHeight: 1.6 }}>
          Organisasjonen mangler organisasjonsnummer i DriftIQ, så styret kan ikke slås opp i
          Enhetsregisteret. Legg det inn under Innstillinger først.
        </p>
      ) : svar?.status === "ingen-svar" ? (
        <p style={{ fontSize: "var(--fs-sm)", lineHeight: 1.6 }}>
          Fikk ikke svar fra Brønnøysundregistrene på org.nr. {nr}. Prøv igjen om litt, eller
          legg inn brukerne manuelt med «＋ Ny bruker».
        </p>
      ) : rader.length === 0 ? (
        <p style={{ fontSize: "var(--fs-sm)", lineHeight: 1.6 }}>
          Fant ingen styreroller registrert på org.nr. {nr} i Enhetsregisteret.
        </p>
      ) : (
        <>
          <div className="tips-stripe" style={{ marginBottom: "14px" }}>
            <span style={{ fontSize: "var(--fs-sm)", lineHeight: 1.6 }}>
              <b>Hentet fra Enhetsregisteret.</b> Tilgangsnivået er forhåndsvalgt ut fra rollen
              og kan endres per person før du oppretter. Tittelen fra registeret er kun en
              beskrivelse og styrer ingenting.
            </span>
          </div>

          <div className="styret-row hode">
            <span />
            <span>Person</span>
            <span>Tilgangsnivå</span>
            <span>E-post (for innlogging)</span>
          </div>
          {rader.map((r, i) => (
            <div key={`${r.navn}-${r.rolle}`} className={`styret-row${r.med || r.finnes ? "" : " av"}`}>
              <input
                type="checkbox"
                checked={r.med}
                disabled={r.finnes || sender}
                aria-label={`Ta med ${r.navn}`}
                onChange={(e) => settRad(i, { med: e.target.checked })}
              />
              <div style={{ minWidth: 0 }}>
                <div className="styret-navn">{r.navn}</div>
                <div className="styret-rolle">
                  {r.rolle}
                  {r.finnes && " · har allerede bruker"}
                </div>
              </div>
              {/* Nivået settes HER, før brukeren finnes — ikke etterpå på hver enkelt.
                  Importerer man åtte personer, er åtte runder i ⋯-menyen etterpå den
                  jobben importen skulle spare en for. */}
              <select
                className="input styret-nivaa"
                value={r.nivaa}
                disabled={!r.med || r.finnes || sender}
                aria-label={`Tilgangsnivå for ${r.navn}`}
                onChange={(e) => settRad(i, { nivaa: e.target.value as Nivaa })}
              >
                {valgbareNivaer.map((n) => (
                  <option key={n.verdi} value={n.verdi}>
                    {n.etikett}
                  </option>
                ))}
              </select>
              <div style={{ minWidth: 0 }}>
                {r.finnes ? (
                  <span className="styret-rolle">
                    {finnesFra.find((u) => u.name.trim().toLowerCase() === r.navn.trim().toLowerCase())?.email ?? ""}
                  </span>
                ) : (
                  <input
                    className="input"
                    type="email"
                    placeholder="navn@eksempel.no"
                    aria-label={`E-post for ${r.navn}`}
                    value={r.epost}
                    disabled={!r.med || sender}
                    onChange={(e) => settRad(i, { epost: e.target.value })}
                  />
                )}
              </div>
            </div>
          ))}
        </>
      )}

      <Feil melding={feil} />

      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "16px" }}>
        {rader.length > 0 && (
          <span
            style={{
              marginRight: "auto",
              fontSize: "var(--fs-label)",
              color: valgte.length > klare.length ? "var(--warn)" : "var(--muted)",
            }}
          >
            {valgte.length > klare.length
              ? `${valgte.length - klare.length} mangler gyldig e-post.`
              : "Nye brukere setter sitt eget passord via «glemt passord»."}
          </span>
        )}
        <button
          type="button"
          className="btn btn-ghost"
          onClick={onTilbake ?? onLukk}
          disabled={sender}
          style={rader.length === 0 ? { marginLeft: "auto" } : undefined}
        >
          {onTilbake ? "Tilbake" : rader.length > 0 ? "Avbryt" : "Lukk"}
        </button>
        {rader.length > 0 && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void opprett()}
            disabled={sender || klare.length === 0}
          >
            {sender
              ? "Oppretter …"
              : klare.length > 0
                ? `Opprett ${klare.length} bruker${klare.length === 1 ? "" : "e"}`
                : "Opprett brukere"}
          </button>
        )}
      </div>
    </Modal>
  );
}
