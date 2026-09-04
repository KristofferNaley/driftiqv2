"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ArrowLeftRight, Bell, Clock, FileText, LayoutDashboard, User } from "lucide-react";
import { Feil, Tom, dato } from "@/components/felles";
import { Fanemodal, Knapperad, Kommer, Modal, Tekstfelt, Tekstomrade, useSending, type Fanevalg } from "@/components/skjema";
import { okonomi, type Eier, type SeksjonDetalj } from "@/lib/klient";
import { KJORING_STATUS_ETIKETT, brokTekst, isoDato, kroner, manedTekst, type KjoringStatus } from "@/lib/okonomiregler";

type Fane = "oversikt" | "eier" | "fakturaer" | "inkasso" | "eierskifte" | "historikk";

/**
 * Én seksjon — fanemodal over lista, etter mockupen «DriftIQ Økonomi» (04.09.2026).
 *
 * Seksjonen er RADEN i registeret; alt som hører til den (eier, satser, fakturagrunnlag,
 * eierskifte, tidslinje) ligger i fanene her, ikke i knapper spredt utover tabellen. Det
 * som krever regnskapskobling — purring og inkasso — er en «Kommer»-fane som sier hva den
 * skal bli, med samme mønster som Integrasjon-fanen.
 */
export default function SeksjonModal({
  orgId,
  unitId,
  erAdmin,
  onLukk,
  onEndret,
}: {
  orgId: string;
  unitId: string;
  erAdmin: boolean;
  onLukk: () => void;
  onEndret: () => Promise<void>;
}) {
  const [data, setData] = useState<SeksjonDetalj | null>(null);
  const [feil, setFeil] = useState<string | null>(null);
  const [fane, setFane] = useState<Fane>("oversikt");
  const [rediger, setRediger] = useState(false);
  const [rett, setRett] = useState<Eier | null>(null);

  const hent = useCallback(async () => {
    try {
      setData(await okonomi.seksjon(orgId, unitId));
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke hente seksjonen");
    }
  }, [orgId, unitId]);
  useEffect(() => {
    void hent();
  }, [hent]);

  async function oppdater() {
    await hent();
    await onEndret();
  }

  const antallLinjer = data?.fakturalinjer.length ?? 0;
  const faner: ReadonlyArray<Fanevalg<Fane>> = [
    { nokkel: "oversikt", etikett: "Oversikt", Ikon: LayoutDashboard },
    { nokkel: "eier", etikett: "Eier", Ikon: User },
    { nokkel: "fakturaer", etikett: antallLinjer ? `Fakturaer (${antallLinjer})` : "Fakturaer", Ikon: FileText },
    { nokkel: "eierskifte", etikett: data && !data.eier ? "Eierskifte !" : "Eierskifte", Ikon: ArrowLeftRight },
    { nokkel: "historikk", etikett: "Historikk", Ikon: Clock },
    { nokkel: "inkasso", etikett: "Purring og inkasso", Ikon: Bell, kommer: true },
  ];

  const status = !data
    ? null
    : !data.eier
      ? { merke: "warn", etikett: "Ingen eier" }
      : data.brokTeller === null
        ? { merke: "warn", etikett: "Uten brøk" }
        : !data.sats
          ? { merke: "warn", etikett: "Uten sats" }
          : { merke: "ok", etikett: "À jour" };

  return (
    <Fanemodal
      tittel={data ? `Seksjon ${data.andelsnr ?? data.navn}` : "Seksjon"}
      onLukk={onLukk}
      bredde={960}
      faner={faner}
      valgt={fane}
      onVelg={setFane}
      topp={
        data && (
          <div className="ok-seksjon-topp">
            <div>
              <h3>{data.navn}</h3>
              <div className="ok-seksjon-sub">
                {[
                  data.oppgang && `oppg. ${data.oppgang}`,
                  data.etasje && `${data.etasje}. etg`,
                  data.arealM2 && `${Number(data.arealM2).toLocaleString("nb-NO")} m²`,
                  `brøk ${brokTekst({ teller: data.brokTeller, nevner: data.brokNevner })}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>
            <div className="ok-handlinger">
              {status && <span className={`badge ${status.merke}`}>{status.etikett}</span>}
              {erAdmin && (
                <button className="btn btn-ghost" onClick={() => setRediger(true)}>
                  Rediger
                </button>
              )}
            </div>
          </div>
        )
      }
    >
      <Feil melding={feil} />
      {!data ? (
        <Tom tekst="Henter …" />
      ) : (
        <div className="ok-seksjon-panel">
          {fane === "oversikt" && <Oversikt d={data} onGaaTil={setFane} />}
          {fane === "eier" && (
            <EierPanel d={data} erAdmin={erAdmin} onRett={setRett} onSkifte={() => setFane("eierskifte")} />
          )}
          {fane === "fakturaer" && <FakturaPanel d={data} />}
          {fane === "eierskifte" && (
            <EierskiftePanel
              d={data}
              erAdmin={erAdmin}
              onLagre={async (felter) => {
                await okonomi.registrerEier(orgId, { unitId: data.unitId, ...felter });
                await oppdater();
                setFane("eier");
              }}
              onSlett={async (e) => {
                await okonomi.slettEier(orgId, e.id);
                await oppdater();
              }}
            />
          )}
          {fane === "historikk" && <HistorikkPanel d={data} />}
          {fane === "inkasso" && (
            <Kommer
              Ikon={Bell}
              tekst="Purring og inkasso følger betalingsstatusen fra regnskapssystemet, og krever Fiken-koblingen."
              punkter={[
                "Betalingsstatus per faktura leses fra Fiken hver natt — «hvem har ikke betalt» uten at DriftIQ rører en krone",
                "Betalingspåminnelse uten gebyr etter forfall, purring med gebyr etter 14 dager, inkassovarsel etter nye 14 (inkassoloven § 9)",
                "Legalpant etter eierseksjonsloven § 31 dekker inntil 2 G — vises som grunnlag før varsel sendes",
                "Betalingsplan avtalt med eier, med sporing i historikken",
              ]}
              notat="Kommer i steg 3 (docs/fiken.md). Fram til da registreres betalinger i regnskapet, og purring gjøres derfra."
            />
          )}
        </div>
      )}

      {rediger && data && (
        <RedigerSeksjonModal
          d={data}
          onLukk={() => setRediger(false)}
          onLagre={async (felter) => {
            await okonomi.settBrok(orgId, data.unitId, felter);
            await oppdater();
          }}
        />
      )}

      {rett && (
        <RettEierModal
          eier={rett}
          onLukk={() => setRett(null)}
          onLagre={async (felter) => {
            await okonomi.endreEier(orgId, rett.id, felter);
            await oppdater();
          }}
        />
      )}
    </Fanemodal>
  );
}

// ---------------------------------------------------------------------------------------

function Fakta({ etikett, verdi, dempet }: { etikett: string; verdi: ReactNode; dempet?: boolean }) {
  return (
    <div>
      <span className="ok-fakta-et">{etikett}</span>
      <div className={`ok-fakta-v${dempet ? " mut" : ""}`}>{verdi}</div>
    </div>
  );
}

function Tidslinje({ rader, maks }: { rader: SeksjonDetalj["historikk"]; maks?: number }) {
  const vis = maks ? rader.slice(0, maks) : rader;
  if (vis.length === 0) return <Tom tekst="Ingen hendelser ennå." />;
  return (
    <div className="ok-hist">
      {vis.map((h, i) => (
        <div key={i} className={h.tone}>
          <div className="ok-hist-t">{h.tittel}</div>
          <div className="ok-hist-d">
            {dato(h.dato)} · {h.detalj}
          </div>
        </div>
      ))}
    </div>
  );
}

function Oversikt({ d, onGaaTil }: { d: SeksjonDetalj; onGaaTil: (f: Fane) => void }) {
  const neste = d.fakturalinjer.find((l) => l.month >= isoDato(new Date()).slice(0, 7) + "-01");
  return (
    <>
      <div className="ok-fakta">
        <Fakta etikett="Felleskost/mnd" verdi={d.sats ? kroner(d.sats.monthlyAmount) : "—"} />
        <Fakta etikett="Eier" verdi={d.eier?.name ?? "Ingen eier"} />
        <Fakta etikett="Eier siden" verdi={d.eier ? dato(d.eier.ownerFrom) : "—"} dempet />
        <Fakta etikett="Brøk" verdi={brokTekst({ teller: d.brokTeller, nevner: d.brokNevner })} />
        <Fakta etikett="Neste faktura" verdi={neste ? `${manedTekst(neste.month)} · ${kroner(neste.amount)}` : "Ikke i grunnlag"} dempet={!neste} />
        <Fakta etikett="Tidligere eiere" verdi={String(d.tidligere.length)} dempet />
      </div>

      {!d.eier && (
        <div className="ok-melding" style={{ background: "rgba(245,166,35,0.1)", color: "var(--warn)", borderColor: "rgba(245,166,35,0.3)" }}>
          Seksjonen har ingen registrert eier. Fakturagrunnlaget får linjer uten mottaker til det er rettet —{" "}
          <button className="ok-lenkeknapp" onClick={() => onGaaTil("eierskifte")}>
            registrer eier
          </button>
          .
        </div>
      )}
      {d.eier && !d.sats && (
        <div className="ok-melding" style={{ background: "rgba(245,166,35,0.1)", color: "var(--warn)", borderColor: "rgba(245,166,35,0.3)" }}>
          Seksjonen mangler felleskostnadssats. Beregn satser fra vedtatt budsjett, eller sett sats under Felleskostnader.
        </div>
      )}

      <div className="ok-to-kolonner">
        <div>
          <h4 className="ok-underoverskrift">Siste hendelser</h4>
          <Tidslinje rader={d.historikk} maks={4} />
        </div>
        <div>
          <h4 className="ok-underoverskrift">Kontakt</h4>
          {d.eier ? (
            <>
              <div className="list-meta">{d.eier.email ?? "ingen e-post"}</div>
              <div className="list-meta">{d.eier.phone ?? "ingen telefon"}</div>
              {d.eier.invoiceAddress && <div className="list-meta">Faktura: {d.eier.invoiceAddress}</div>}
              <button className="btn btn-ghost" style={{ marginTop: "10px" }} onClick={() => onGaaTil("eier")}>
                Eierkortet
              </button>
            </>
          ) : (
            <Tom tekst="Ingen eier." />
          )}
        </div>
      </div>
    </>
  );
}

function EierPanel({
  d,
  erAdmin,
  onRett,
  onSkifte,
}: {
  d: SeksjonDetalj;
  erAdmin: boolean;
  onRett: (e: Eier) => void;
  onSkifte: () => void;
}) {
  return (
    <>
      {d.eier ? (
        <div className="card">
          <div className="card-header">
            <div className="card-title">Eier og fakturamottaker</div>
            {erAdmin && (
              <div className="ok-handlinger" style={{ marginLeft: "auto" }}>
                <button className="btn btn-ghost" onClick={() => onRett(d.eier!)}>
                  Rett opplysninger
                </button>
                <button className="btn btn-ghost" onClick={onSkifte}>
                  Eierskifte
                </button>
              </div>
            )}
          </div>
          <div className="card-body">
            <div className="ok-fakta" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
              <Fakta etikett="Navn" verdi={d.eier.name} />
              <Fakta etikett="Eier siden" verdi={dato(d.eier.ownerFrom)} dempet />
              <Fakta etikett="E-post" verdi={d.eier.email ?? "—"} dempet />
              <Fakta etikett="Telefon" verdi={d.eier.phone ?? "—"} dempet />
              <Fakta etikett="Fakturaadresse" verdi={d.eier.invoiceAddress ?? "Seksjonen"} dempet />
              {d.eier.note && <Fakta etikett="Notat" verdi={d.eier.note} dempet />}
            </div>
          </div>
        </div>
      ) : (
        <Tom tekst="Ingen registrert eier. Registrer under Eierskifte." />
      )}

      {d.tidligere.length > 0 && (
        <div>
          <h4 className="ok-underoverskrift">Tidligere eiere</h4>
          {d.tidligere.map((e) => (
            <div key={e.id} className="ok-hist-rad">
              <div style={{ minWidth: 0 }}>
                <div className="list-tittel">{e.name}</div>
                <div className="list-meta">
                  {dato(e.ownerFrom)} – {e.ownerTo ? dato(e.ownerTo) : "…"}
                  {e.email && ` · ${e.email}`}
                </div>
              </div>
              {erAdmin && (
                <button className="btn btn-ghost" onClick={() => onRett(e)}>
                  Rett
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function FakturaPanel({ d }: { d: SeksjonDetalj }) {
  if (d.fakturalinjer.length === 0) {
    return <Tom tekst="Ingen fakturagrunnlag laget for seksjonen ennå. Kjør et halvår under Felleskostnader." />;
  }
  return (
    <>
      <p className="ok-tekst" style={{ padding: 0 }}>
        Linjene fra halvårskjøringene. Betalingsstatus kommer med regnskapskoblingen; fram til da er dette
        grunnlaget slik det ble sendt til fakturering.
      </p>
      <div className="ok-grunnlag" style={{ maxHeight: "none" }}>
        <div className="ok-seksfakt-hode" aria-hidden>
          <span>Måned</span>
          <span>Forfall</span>
          <span className="ok-belop-celle">Beløp</span>
          <span>Status</span>
        </div>
        {d.fakturalinjer.map((l) => {
          const st = KJORING_STATUS_ETIKETT[l.kjoringStatus as KjoringStatus] ?? { etikett: l.kjoringStatus, merke: "muted" };
          return (
            <div key={l.id} className="ok-seksfakt-rad">
              <span>
                <span className="list-tittel">{manedTekst(l.month)}</span>
                <span className="list-meta"> · {l.ownerName ?? "ingen mottaker"}</span>
              </span>
              <span className="list-meta">{dato(l.dueDate)}</span>
              <span className="ok-belop-celle">{kroner(l.amount)}</span>
              <span>
                <span className={`badge ${st.merke}`}>{st.etikett}</span>
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}

function EierskiftePanel({
  d,
  erAdmin,
  onLagre,
  onSlett,
}: {
  d: SeksjonDetalj;
  erAdmin: boolean;
  onLagre: (felter: {
    name: string; email: string | null; phone: string | null; invoiceAddress: string | null;
    ownerFrom: string; note: string | null;
  }) => Promise<void>;
  onSlett: (e: Eier) => Promise<void>;
}) {
  const [navn, setNavn] = useState("");
  const [epost, setEpost] = useState("");
  const [telefon, setTelefon] = useState("");
  const [adresse, setAdresse] = useState("");
  const [fra, setFra] = useState(isoDato(new Date()));
  const [notat, setNotat] = useState("");
  const { sender, feil, send } = useSending(() => {});

  if (!erAdmin) {
    return <Tom tekst="Eierskifte registreres av kontoadmin." />;
  }

  return (
    <>
      <div className="card">
        <div className="card-header">
          <div className="card-title">{d.eier ? "Ny eier (eierskifte)" : "Registrer eier"}</div>
        </div>
        <form
          className="card-body"
          style={{ display: "flex", flexDirection: "column", gap: "14px" }}
          onSubmit={(e) => {
            e.preventDefault();
            void send(() =>
              onLagre({
                name: navn, email: epost.trim() || null, phone: telefon.trim() || null,
                invoiceAddress: adresse.trim() || null, ownerFrom: fra, note: notat.trim() || null,
              }),
            );
          }}
        >
          <div className="field-row">
            <Tekstfelt etikett="Navn" verdi={navn} onEndre={setNavn} />
            <Tekstfelt etikett="Overtar fra" verdi={fra} onEndre={setFra} type="date" />
          </div>
          <div className="field-row">
            <Tekstfelt etikett="E-post" verdi={epost} onEndre={setEpost} type="email" notat="Faktura sendes hit når regnskapskoblingen er på" />
            <Tekstfelt etikett="Telefon" verdi={telefon} onEndre={setTelefon} />
          </div>
          <Tekstomrade etikett="Fakturaadresse" verdi={adresse} onEndre={setAdresse} rader={2} plassholder="Bare når den er en annen enn seksjonen (utleier, verge, dødsbo)" />
          <Tekstomrade etikett="Notat" verdi={notat} onEndre={setNotat} rader={2} />
          <div className="field-note">
            {d.eier
              ? `${d.eier.name} får sluttdato dagen før overtakelsen. Overtakelsesmåneden faktureres i sin helhet den som eier seksjonen den 1. — kjøper og selger gjør opp seg imellom. Linjer som alt er laget, blir stående.`
              : "Første eier på seksjonen. Fakturagrunnlag laget uten eier peker fortsatt på ingen — kjør perioden på nytt om det trengs."}
          </div>
          <Feil melding={feil} />
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button className="btn btn-primary" disabled={sender}>
              {sender ? "Lagrer …" : d.eier ? "Gjennomfør eierskifte" : "Registrer eier"}
            </button>
          </div>
        </form>
      </div>

      {d.eier && (
        <div>
          <h4 className="ok-underoverskrift">Nåværende eier</h4>
          <div className="ok-hist-rad">
            <div style={{ minWidth: 0 }}>
              <div className="list-tittel">{d.eier.name}</div>
              <div className="list-meta">eier siden {dato(d.eier.ownerFrom)}</div>
            </div>
            <button
              className="btn btn-ghost"
              onClick={() =>
                window.confirm(`Slette registreringen av ${d.eier!.name}? Bare for feilregistreringer — forrige eier gjenåpnes.`) &&
                void onSlett(d.eier!)
              }
            >
              Slett feilregistrering
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function HistorikkPanel({ d }: { d: SeksjonDetalj }) {
  return (
    <>
      <p className="ok-tekst" style={{ padding: 0 }}>
        Tidslinja er regnet ut av registeret selv — eierskifter, satsendringer og fakturagrunnlag — og kan ikke
        sprike fra det. Hendelsesloggen under Innstillinger har hvem som gjorde hva.
      </p>
      <Tidslinje rader={d.historikk} />
    </>
  );
}

// ---------------------------------------------------------------------------------------

function RedigerSeksjonModal({
  d,
  onLukk,
  onLagre,
}: {
  d: SeksjonDetalj;
  onLukk: () => void;
  onLagre: (felter: { teller: number | null; nevner: number | null; arealM2: string | null }) => Promise<void>;
}) {
  const [areal, setAreal] = useState(d.arealM2 ? String(Number(d.arealM2)) : "");
  const [teller, setTeller] = useState(d.brokTeller?.toString() ?? "");
  const [nevner, setNevner] = useState(d.brokNevner?.toString() ?? "");
  const { sender, feil, send } = useSending(onLukk);
  return (
    <Modal tittel={`Rediger ${d.navn}`} onLukk={onLukk}>
      <form
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
        onSubmit={(e) => {
          e.preventDefault();
          void send(() =>
            onLagre({
              teller: teller.trim() === "" ? null : Number(teller),
              nevner: nevner.trim() === "" ? null : Number(nevner),
              arealM2: areal.trim() === "" ? null : areal.replace(",", "."),
            }),
          );
        }}
      >
        <Tekstfelt etikett="BRA m²" verdi={areal} onEndre={setAreal} plassholder="62" />
        <div className="field-row">
          <Tekstfelt etikett="Sameiebrøk, teller" verdi={teller} onEndre={setTeller} type="number" notat="Tinglyst brøk. Grunnlaget for felleskostnadene." />
          <Tekstfelt etikett="Nevner" verdi={nevner} onEndre={setNevner} type="number" />
        </div>
        <div className="field-note">Nummer, oppgang og etasje endres under Innstillinger → Leiligheter.</div>
        <Feil melding={feil} />
        <Knapperad onAvbryt={onLukk} sender={sender} />
      </form>
    </Modal>
  );
}

/** Retting av kontaktopplysninger — datoene røres ikke; det er eierskiftet som eier dem. */
function RettEierModal({
  eier,
  onLukk,
  onLagre,
}: {
  eier: Eier;
  onLukk: () => void;
  onLagre: (d: { name: string; email: string | null; phone: string | null; invoiceAddress: string | null; note: string | null }) => Promise<void>;
}) {
  const [navn, setNavn] = useState(eier.name);
  const [epost, setEpost] = useState(eier.email ?? "");
  const [telefon, setTelefon] = useState(eier.phone ?? "");
  const [adresse, setAdresse] = useState(eier.invoiceAddress ?? "");
  const [notat, setNotat] = useState(eier.note ?? "");
  const { sender, feil, send } = useSending(onLukk);
  return (
    <Modal tittel={`Rett opplysninger om ${eier.name}`} onLukk={onLukk}>
      <form
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
        onSubmit={(e) => {
          e.preventDefault();
          void send(() =>
            onLagre({
              name: navn, email: epost.trim() || null, phone: telefon.trim() || null,
              invoiceAddress: adresse.trim() || null, note: notat.trim() || null,
            }),
          );
        }}
      >
        <Tekstfelt etikett="Navn" verdi={navn} onEndre={setNavn} />
        <div className="field-row">
          <Tekstfelt etikett="E-post" verdi={epost} onEndre={setEpost} type="email" />
          <Tekstfelt etikett="Telefon" verdi={telefon} onEndre={setTelefon} />
        </div>
        <Tekstomrade etikett="Fakturaadresse" verdi={adresse} onEndre={setAdresse} rader={2} />
        <Tekstomrade etikett="Notat" verdi={notat} onEndre={setNotat} rader={2} />
        <Feil melding={feil} />
        <Knapperad onAvbryt={onLukk} sender={sender} />
      </form>
    </Modal>
  );
}
