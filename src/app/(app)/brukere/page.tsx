"use client";

import { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { useOkt } from "@/components/OktProvider";
import { Feil, Tom, dagerSiden, initialer, siden, useOrgData } from "@/components/felles";
import { Knapperad, Modal, Tekstfelt, useSending } from "@/components/skjema";
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
 * som må lage kontoer selv. Å ENDRE en eksisterende bruker krever `orgadmin` — derfor står
 * ⋯-knappen på `erAdmin`, mens knappene i toppen står på `kanOpprette`.
 */
export default function Brukere() {
  const { aktivOrg } = useOkt();
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
          <button className="btn btn-primary" onClick={() => setLegger("velg")}>
            ＋ Legg til bruker
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
          erAdmin={erAdmin}
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
      <BrukerModal
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

  return (
    <div className="list-item bruker-rad">
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
        <button className="ikon-btn" title="Rediger" onClick={() => onEndre(b)}>
          ⋯
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}

/**
 * Én modal for både ny og eksisterende bruker — som i v1. To nesten like modaler drifter fra
 * hverandre; her er forskjellen bare hvilke seksjoner som vises.
 */
function BrukerModal({
  bruker,
  orgId,
  erAdmin,
  onLukk,
  onLagret,
  onFeil,
  onTilbake,
}: {
  bruker?: OrgBruker;
  orgId: string;
  erAdmin: boolean;
  onLukk: () => void;
  onLagret: () => Promise<void>;
  onFeil?: (m: string) => void;
  /** Satt når modalen er nådd via valgsteget — da skal «Avbryt» gå ETT steg tilbake. */
  onTilbake?: () => void;
}) {
  const endrer = !!bruker;
  const egenTittel = !!bruker?.title && !VANLIGE_TITLER.includes(bruker.title);

  const [navn, setNavn] = useState(bruker?.name ?? "");
  const [epost, setEpost] = useState(bruker?.email ?? "");
  const [nivaa, setNivaa] = useState<Nivaa>((bruker?.nivaa as Nivaa) ?? "redigering");
  const [tittelValg, setTittelValg] = useState(egenTittel ? "__egen__" : (bruker?.title ?? ""));
  const [egenTittelTekst, setEgenTittelTekst] = useState(egenTittel ? bruker!.title! : "");
  const [bekrefterFjern, setBekrefterFjern] = useState(false);
  const [sendtOppsett, setSendtOppsett] = useState(false);

  // Varslene ligger på medlemskapet og lagres for seg (eget endepunkt) — de finnes ikke før
  // brukeren gjør det, så seksjonen vises kun ved redigering.
  const [varsler, setVarsler] = useState<Record<string, boolean> | null>(null);
  useEffect(() => {
    if (!endrer) return;
    brukere
      .varsler(orgId, bruker!.id)
      .then((r) => setVarsler({ ...VARSEL_STANDARD, ...r.prefs }))
      .catch(() => setVarsler({ ...VARSEL_STANDARD }));
  }, [endrer, orgId, bruker]);

  const { sender, feil, send } = useSending(async () => {
    await onLagret();
    onLukk();
  });

  // Ingen kan dele ut et nivå de ikke har selv: en `redigering`-bruker som oppretter en konto
  // skal ikke kunne gjøre den til kontoadmin og logge inn som den. Håndheves i API-et — dette
  // er bare speilingen i UI-et.
  const valgbare = erAdmin ? TILGANGSNIVAER : TILGANGSNIVAER.filter((n) => n.verdi !== "orgadmin");
  const tittel = tittelValg === "__egen__" ? egenTittelTekst.trim() || null : tittelValg || null;

  async function lagre() {
    // Varslene har sitt eget endepunkt, så de skrives for seg. Rekkefølgen er med vilje:
    // feiler tilgangsendringen, skal varslene ikke allerede være lagret.
    if (endrer) {
      await brukere.endre(orgId, bruker!.id, { name: navn.trim(), role: nivaa, title: tittel });
      if (varsler) await brukere.settVarsler(orgId, bruker!.id, varsler);
    } else {
      await brukere.inviter(orgId, { name: navn.trim(), email: epost.trim(), role: nivaa, title: tittel });
    }
  }

  async function fjern() {
    try {
      await brukere.fjern(orgId, bruker!.id);
      await onLagret();
      onLukk();
    } catch (e) {
      // «Organisasjonen må ha minst én administrator» kommer hit.
      onFeil?.(e instanceof Error ? e.message : "Kunne ikke fjerne tilgangen");
      onLukk();
    }
  }

  if (bekrefterFjern && bruker) {
    return (
      <Modal tittel="Fjern tilgang" onLukk={() => setBekrefterFjern(false)} bredde={380}>
        <p style={{ fontSize: "var(--fs-sm)", lineHeight: 1.6 }}>
          Fjern <strong>{bruker.name}</strong> sin tilgang til denne organisasjonen? Personen kan
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
    );
  }

  return (
    <Modal tittel={endrer ? "Rediger bruker" : "Ny bruker"} onLukk={onLukk}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(lagre);
        }}
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
      >
        <Feil melding={feil} />

        <Tekstfelt etikett="Fullt navn *" verdi={navn} onEndre={setNavn} />

        {/* E-posten er innloggingsnøkkelen og kan ikke endres her. Feltet vises likevel —
            det er ofte det man leter etter når man åpner en bruker. */}
        <Tekstfelt
          etikett="E-postadresse *"
          type="email"
          verdi={epost}
          onEndre={setEpost}
          laast={endrer}
          notat={
            endrer
              ? "E-post kan ikke endres"
              : "Finnes adressen fra før, får den kontoen bare tilgang hit — én person skal ha én konto, ikke to."
          }
        />

        <div className="field">
          <label className="field-label" htmlFor="tittel">
            Tittel i organisasjonen
          </label>
          <select
            id="tittel"
            className="input"
            value={tittelValg}
            onChange={(e) => setTittelValg(e.target.value)}
          >
            <option value="">Ingen tittel</option>
            {VANLIGE_TITLER.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
            <option value="__egen__">Annet …</option>
          </select>
          {tittelValg === "__egen__" && (
            <input
              className="input"
              style={{ marginTop: "8px" }}
              value={egenTittelTekst}
              placeholder="Skriv tittelen"
              aria-label="Egen tittel"
              onChange={(e) => setEgenTittelTekst(e.target.value)}
            />
          )}
          <div className="field-note">
            Ren beskrivelse. Fram til 08.08.2026 utledet v1 tilgang av tittelen — nå styrer den
            ingenting, og nivået under er det eneste som gjelder.
          </div>
        </div>

        {/* Kort, ikke nedtrekk: nivået er sidens viktigste valg, og beskrivelsen må være
            synlig NÅR man velger — ikke etterpå. */}
        <div className="field">
          <span className="field-label">Tilgangsnivå</span>
          {valgbare.map((n) => (
            <button
              key={n.verdi}
              type="button"
              className={`nivaa-kort${nivaa === n.verdi ? " valgt" : ""}`}
              onClick={() => setNivaa(n.verdi)}
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

        {endrer && (
          <div className="field">
            <span className="field-label">Varsler</span>
            <div className="field-note" style={{ marginBottom: "6px" }}>
              Hvilke e-poster denne personen får, sendt til {bruker!.email}. Hver enkelt kan også
              endre dette selv under Innstillinger.
            </div>
            {varsler === null ? (
              <div className="field-note">Henter …</div>
            ) : (
              VARSLER.map((v) => (
                <label key={v.nokkel} className="varsel-valg">
                  <input
                    type="checkbox"
                    checked={varsler[v.nokkel] ?? false}
                    onChange={(e) => setVarsler({ ...varsler, [v.nokkel]: e.target.checked })}
                  />
                  <span style={{ minWidth: 0 }}>
                    <span className="varsel-navn">{v.etikett}</span>
                    <span className="varsel-desc">{v.beskrivelse}</span>
                  </span>
                </label>
              ))
            )}
          </div>
        )}

        {endrer ? (
          <div className="field">
            <span className="field-label">Kontohandlinger</span>
            <button
              type="button"
              className="btn btn-ghost profil-handling"
              disabled={sendtOppsett}
              onClick={() => {
                // Svaret er alltid «sendt». Om adressen tar imot den, vet vi først når
                // brukeren logger inn — å love mer enn det ville vært å lyve.
                void brukere.sendOppsett(orgId, bruker!.id).catch(() => {});
                setSendtOppsett(true);
              }}
            >
              {sendtOppsett ? "E-post sendt" : bruker!.harSattPassord ? "Send lenke for nytt passord" : "Send oppsett-e-post på nytt"}
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
        ) : (
          <div className="field-note">
            Brukeren får en e-post med en engangslenke der de setter sitt eget passord. Du
            velger det ikke for dem — da ville to personer kjent det.
          </div>
        )}

        <Knapperad
          onAvbryt={onTilbake ?? onLukk}
          avbrytEtikett={onTilbake ? "Tilbake" : "Avbryt"}
          sendEtikett={endrer ? "Lagre endringer" : "Opprett bruker"}
          sender={sender}
          deaktivert={!navn.trim() || (!endrer && !epost.trim())}
        />
      </form>
    </Modal>
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
