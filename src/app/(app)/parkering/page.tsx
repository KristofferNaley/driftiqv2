"use client";

import { useState } from "react";
import Layout from "@/components/Layout";
import { Faner, Feil, Tom, dato, useOrgData } from "@/components/felles";
import { Knapperad, Modal, Nedtrekk, Tekstfelt, Tekstomrade, useSending } from "@/components/skjema";
import { useOkt } from "@/components/OktProvider";
import { parkering, type Plass } from "@/lib/klient";

/**
 * Parkering — v1-paritet: plasser med eierskap/type/status og redigeringsmodal,
 * leieavtaler (kun ledige felleseide plasser kan leies ut), og venteliste. Sidepanelet
 * forklarer eierskapsformene — det er dem hele fordelingsdiskusjonen i et styre står om.
 */

const EIERSKAP_INFO: Record<string, { etikett: string; farge: string; bg: string; forklaring: string }> = {
  tinglyst: {
    etikett: "Tinglyst",
    farge: "#8b5cf6",
    bg: "rgba(139, 92, 246, 0.1)",
    forklaring: "Følger boenheten permanent, styret disponerer ikke",
  },
  seksjon: {
    etikett: "Egen seksjon",
    farge: "var(--accent)",
    bg: "rgba(var(--accent-rgb), 0.1)",
    forklaring: "Selvstendig eiendom, kjøpt separat av eier",
  },
  felles: {
    etikett: "Felleseie",
    farge: "#0fba81",
    bg: "rgba(15, 186, 129, 0.1)",
    forklaring: "Eies av sameiet/laget — styret fordeler eller leier ut",
  },
};

const PLASSTYPE: Record<string, { etikett: string; ikon: string }> = {
  standard: { etikett: "Standard", ikon: "🚗" },
  lading: { etikett: "Lading", ikon: "⚡" },
  gjest: { etikett: "Gjest", ikon: "🅿️" },
};

const STATUS: Record<string, { etikett: string; farge: string }> = {
  disponert: { etikett: "Disponert", farge: "#0fba81" },
  ledig: { etikett: "Ledig", farge: "#f5a623" },
  utleid: { etikett: "Utleid", farge: "var(--accent)" },
};

const FILTRE = [
  { nokkel: "alle", etikett: "Alle" },
  { nokkel: "tinglyst", etikett: "Tinglyst" },
  { nokkel: "seksjon", etikett: "Seksjonert" },
  { nokkel: "felles", etikett: "Felleseie" },
  { nokkel: "lading", etikett: "⚡ Lading" },
] as const;

type Filter = (typeof FILTRE)[number]["nokkel"];
type Fane = "alle" | "avtaler" | "venteliste" | "lading";

export default function Parkering() {
  const { aktivOrg } = useOkt();
  const kanEndre = aktivOrg?.nivaa === "orgadmin" || aktivOrg?.nivaa === "redigering";

  const [fane, setFane] = useState<Fane>("alle");
  const [filter, setFilter] = useState<Filter>("alle");
  const [plassModal, setPlassModal] = useState<Plass | "ny" | null>(null);
  const [avtaleModal, setAvtaleModal] = useState(false);
  const [ventelisteModal, setVentelisteModal] = useState(false);

  const { data, feil, setFeil, laster, last, orgId } = useOrgData(async (o) => {
    const [plasser, avtaler, venteliste] = await Promise.all([
      parkering.plasser(o),
      parkering.avtaler(o),
      parkering.venteliste(o),
    ]);
    return { plasser, avtaler, venteliste };
  });

  const plasser = data?.plasser ?? [];
  const avtaler = data?.avtaler ?? [];
  const venteliste = data?.venteliste ?? [];

  async function utfor(fn: () => Promise<unknown>, ellers: string) {
    setFeil(null);
    try {
      await fn();
      await last();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : ellers);
    }
  }

  const ledige = plasser.filter((p) => p.status === "ledig").length;
  const disponerte = plasser.length - ledige;
  const medLading = plasser.filter((p) => p.spotType === "lading").length;
  const leieinntekt = avtaler.reduce((n, a) => n + a.pricePerMonth, 0);

  const antall = (f: Filter) =>
    f === "alle"
      ? plasser.length
      : f === "lading"
        ? medLading
        : plasser.filter((p) => p.ownershipType === f).length;

  const synligePlasser = plasser.filter((p) => {
    if (fane === "lading") return p.spotType === "lading";
    if (filter === "lading") return p.spotType === "lading";
    if (filter === "alle") return true;
    return p.ownershipType === filter;
  });

  const plassMedId = new Map(plasser.map((p) => [p.id, p]));

  /* Eierskapsforklaring, venteliste og leieavtaler er oppslag ved siden av plasstabellen
     — de hører i høyremenyen, og bare på fanene der plasstabellen står. */
  const aside =
    fane === "alle" || fane === "lading" ? (
      <>
        <div className="card">
          <div className="card-header"><span className="card-title">Eierskapstyper</span></div>
          <div style={{ padding: "8px 18px 12px" }}>
            {Object.entries(EIERSKAP_INFO).map(([n, info], i) => (
              <div
                key={n}
                style={{
                  display: "flex",
                  gap: "9px",
                  padding: "7px 0",
                  borderBottom: i < 2 ? "1px solid var(--border)" : "none",
                }}
              >
                <span
                  style={{
                    width: "12px",
                    height: "12px",
                    borderRadius: "4px",
                    background: info.farge,
                    flexShrink: 0,
                    marginTop: "3px",
                  }}
                  aria-hidden
                />
                <span style={{ fontSize: "var(--fs-label)", lineHeight: 1.5 }}>
                  <strong style={{ display: "block" }}>{info.etikett}</strong>
                  {info.forklaring}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">Venteliste</span>
            <button
              onClick={() => setFane("venteliste")}
              style={{
                background: "none",
                border: "none",
                color: "var(--accent)",
                fontSize: "var(--fs-label)",
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "var(--font-sans)",
              }}
            >
              Se alle {venteliste.length} →
            </button>
          </div>
          {venteliste.length === 0 ? (
            <div className="tom-melding">Ingen på venteliste.</div>
          ) : (
            venteliste.slice(0, 3).map((v, i) => (
              <div key={v.id} className="list-item">
                <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
                  <span className="prk-posisjon">{i + 1}</span>
                  <span style={{ minWidth: 0 }}>
                    <span className="list-tittel">{v.name}</span>
                    <span className="list-meta">Ventet siden {dato(v.requestedAt)}</span>
                  </span>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="card">
          <div className="card-header"><span className="card-title">Aktive leieavtaler</span></div>
          {avtaler.length === 0 ? (
            <div className="tom-melding">Ingen aktive leieavtaler.</div>
          ) : (
            avtaler.slice(0, 3).map((a) => (
              <div key={a.id} className="list-item">
                <div style={{ minWidth: 0 }}>
                  <span className="list-tittel">
                    {a.tenantName} — {plassMedId.get(a.spotId)?.number ?? "—"}
                  </span>
                  <span className="list-meta">
                    {a.endDate ? `Utløper ${dato(a.endDate)}` : "Løpende"}
                    {a.noticePeriodMonths ? ` · oppsigelse ${a.noticePeriodMonths} mnd` : ""}
                  </span>
                </div>
                <span style={{ fontWeight: 700, color: "var(--accent)", fontSize: "var(--fs-sm)" }}>
                  {a.pricePerMonth.toLocaleString("nb-NO")} kr
                </span>
              </div>
            ))
          )}
        </div>
      </>
    ) : undefined;

  return (
    <Layout
      tittel="Parkering"
      subnav={
        <Faner
          valgt={fane}
          onVelg={setFane}
          faner={[
            { nokkel: "alle", etikett: "Alle plasser" },
            { nokkel: "avtaler", etikett: "Leieavtaler" },
            { nokkel: "venteliste", etikett: "Venteliste" },
            { nokkel: "lading", etikett: "Ladeplasser" },
          ]}
        />
      }
      handlinger={
        kanEndre ? (
          <>
            {(fane === "alle" || fane === "lading") && (
              <button className="btn btn-primary" onClick={() => setPlassModal("ny")}>
                ＋ Registrer plass
              </button>
            )}
            {fane === "avtaler" && (
              <button className="btn btn-primary" onClick={() => setAvtaleModal(true)}>
                ＋ Ny leieavtale
              </button>
            )}
            {fane === "venteliste" && (
              <button className="btn btn-primary" onClick={() => setVentelisteModal(true)}>
                ＋ Legg til
              </button>
            )}
          </>
        ) : undefined
      }
      aside={aside}
    >
      <div className="page-content">
        <Feil melding={feil} />

        <div className="auto-grid">
          <Kpi etikett="Totalt plasser" verdi={String(plasser.length)} farge="var(--accent)" sub={`${medLading} med lading`} />
          <Kpi
            etikett="Disponert"
            verdi={String(disponerte)}
            farge="#0fba81"
            sub={plasser.length > 0 ? `${Math.round((disponerte / plasser.length) * 100)} % belegg` : "—"}
          />
          <Kpi etikett="Ledige" verdi={String(ledige)} farge="#f5a623" sub="Kan tildeles" />
          <Kpi
            etikett="På venteliste"
            verdi={String(venteliste.length)}
            farge="#8b5cf6"
            sub={venteliste.length > 0 ? `Lengst ventet: ${dato(venteliste[0]!.requestedAt)}` : "—"}
          />
          <Kpi
            etikett="Leieinntekt/mnd"
            verdi={`${leieinntekt.toLocaleString("nb-NO")} kr`}
            farge="var(--text)"
            sub={`fra ${avtaler.length} leieavtaler`}
          />
        </div>

        {laster && !data ? (
          <Tom tekst="Henter …" />
        ) : fane === "alle" || fane === "lading" ? (
          <div className="card">
            {fane === "alle" && (
              <div
                style={{
                  padding: "10px 18px",
                  borderBottom: "1px solid var(--border)",
                  display: "flex",
                  gap: "8px",
                  flexWrap: "wrap",
                }}
              >
                {FILTRE.map((f) => (
                  <button
                    key={f.nokkel}
                    className={`pille${filter === f.nokkel ? " valgt" : ""}`}
                    onClick={() => setFilter(f.nokkel)}
                  >
                    {f.etikett} ({antall(f.nokkel)})
                  </button>
                ))}
              </div>
            )}
            <div className="prk-scroll">
              <div className="prk-min">
                <div className="prk-hode prk-plass">
                  <span>Nr.</span><span>Disponent</span><span>Eierskap</span><span>Type</span><span>Status</span><span />
                </div>
                {synligePlasser.length === 0 ? (
                  <Tom tekst="Ingen plasser matcher filteret." />
                ) : (
                  synligePlasser.map((p) => {
                    const eier = EIERSKAP_INFO[p.ownershipType] ?? {
                      etikett: p.ownershipType,
                      farge: "var(--muted)",
                      bg: "var(--surface2)",
                      forklaring: "",
                    };
                    const type = PLASSTYPE[p.spotType] ?? { etikett: p.spotType, ikon: "🚗" };
                    const st = STATUS[p.status] ?? { etikett: p.status, farge: "var(--muted)" };
                    return (
                      <div key={p.id} className="prk-rad prk-plass">
                        <span className="prk-nr">{p.number}</span>
                        <span style={{ minWidth: 0 }}>
                          <span className="list-tittel">{p.holderName || "— Ledig —"}</span>
                          <span className="list-meta">
                            {p.unitLabel || p.areaLabel || eier.etikett}
                            {p.lease ? ` · leid av ${p.lease.tenantName}` : ""}
                          </span>
                        </span>
                        <span className="prk-pill" style={{ background: eier.bg, color: eier.farge }}>
                          {eier.etikett}
                        </span>
                        <span style={{ fontSize: "var(--fs-label)", color: "var(--muted)" }}>
                          {type.ikon} {type.etikett}
                        </span>
                        <span style={{ fontSize: "var(--fs-label)", fontWeight: 600, color: st.farge }}>
                          ● {st.etikett}
                        </span>
                        <span style={{ display: "flex", justifyContent: "flex-end" }}>
                          {kanEndre && (
                            <button className="btn btn-ghost" onClick={() => setPlassModal(p)}>
                              Rediger
                            </button>
                          )}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        ) : fane === "avtaler" ? (
          <div className="card">
            <div className="prk-scroll">
              <div className="prk-min">
                <div className="prk-hode prk-avtale">
                  <span>Leietaker / plass</span><span>Pris/mnd</span><span>Start</span><span>Slutt</span><span />
                </div>
                {avtaler.length === 0 ? (
                  <Tom tekst="Ingen leieavtaler registrert." />
                ) : (
                  avtaler.map((a) => (
                    <div key={a.id} className="prk-rad prk-avtale">
                      <span style={{ minWidth: 0 }}>
                        <span className="list-tittel">{a.tenantName}</span>
                        <span className="list-meta">{plassMedId.get(a.spotId)?.number ?? "—"}</span>
                      </span>
                      <span style={{ fontWeight: 700, fontSize: "var(--fs-sm)" }}>
                        {a.pricePerMonth.toLocaleString("nb-NO")} kr
                      </span>
                      <span className="list-meta">{dato(a.startDate)}</span>
                      <span className="list-meta">{a.endDate ? dato(a.endDate) : "Løpende"}</span>
                      <span style={{ display: "flex", justifyContent: "flex-end" }}>
                        {kanEndre && (
                          <button
                            className="btn btn-ghost"
                            style={{ color: "var(--danger)" }}
                            onClick={() =>
                              void utfor(
                                () => parkering.avsluttAvtale(orgId!, a.id),
                                "Kunne ikke avslutte avtalen",
                              )
                            }
                          >
                            Avslutt
                          </button>
                        )}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="card">
            <div className="prk-scroll">
              <div className="prk-min">
                <div className="prk-hode prk-vente">
                  <span>#</span><span>Navn</span><span>Ventet siden</span><span>Ønsket type</span><span />
                </div>
                {venteliste.length === 0 ? (
                  <Tom tekst="Ingen på venteliste." />
                ) : (
                  venteliste.map((v, i) => {
                    const type = PLASSTYPE[v.requestedType] ?? { etikett: v.requestedType, ikon: "🚗" };
                    return (
                      <div key={v.id} className="prk-rad prk-vente">
                        <span className="prk-posisjon">{i + 1}</span>
                        <span style={{ minWidth: 0 }}>
                          <span className="list-tittel">{v.name}</span>
                          {v.notes && <span className="list-meta">{v.notes}</span>}
                        </span>
                        <span className="list-meta">{dato(v.requestedAt)}</span>
                        <span className="prk-pill" style={{ background: "var(--surface2)", color: "var(--accent)" }}>
                          {type.ikon} {type.etikett}
                        </span>
                        <span style={{ display: "flex", justifyContent: "flex-end" }}>
                          {kanEndre && (
                            <button
                              className="btn btn-ghost"
                              style={{ color: "var(--danger)" }}
                              onClick={() =>
                                void utfor(
                                  () => parkering.slettVentende(orgId!, v.id),
                                  "Kunne ikke fjerne fra ventelisten",
                                )
                              }
                            >
                              Fjern
                            </button>
                          )}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {plassModal && orgId && (
        <PlassModal
          orgId={orgId}
          plass={plassModal === "ny" ? null : plassModal}
          onLukk={() => setPlassModal(null)}
          onLagret={() => {
            setPlassModal(null);
            void last();
          }}
        />
      )}
      {avtaleModal && orgId && (
        <AvtaleModal
          orgId={orgId}
          plasser={plasser}
          onLukk={() => setAvtaleModal(false)}
          onLagret={() => {
            setAvtaleModal(false);
            void last();
          }}
        />
      )}
      {ventelisteModal && orgId && (
        <VentelisteModal
          orgId={orgId}
          onLukk={() => setVentelisteModal(false)}
          onLagret={() => {
            setVentelisteModal(false);
            void last();
          }}
        />
      )}
    </Layout>
  );
}

function Kpi({ etikett, verdi, farge, sub }: { etikett: string; verdi: string; farge: string; sub: string }) {
  return (
    <div className="card" style={{ padding: "16px", position: "relative", overflow: "hidden" }}>
      <span className="prk-kpi-strek" style={{ background: farge }} aria-hidden />
      <div className="pf-under" style={{ textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 600 }}>
        {etikett}
      </div>
      <div style={{ fontSize: "var(--fs-lg)", fontWeight: 700, marginTop: "6px", color: farge }}>{verdi}</div>
      <div className="list-meta" style={{ marginTop: "4px" }}>{sub}</div>
    </div>
  );
}

// ── Modaler ─────────────────────────────────────────────────────────────────────────────

function PlassModal({
  orgId,
  plass,
  onLukk,
  onLagret,
}: {
  orgId: string;
  plass: Plass | null;
  onLukk: () => void;
  onLagret: () => void;
}) {
  const [nummer, setNummer] = useState(plass?.number ?? "");
  const [omrade, setOmrade] = useState(plass?.areaLabel ?? "");
  const [eierskap, setEierskap] = useState(plass?.ownershipType ?? "felles");
  const [type, setType] = useState(plass?.spotType ?? "standard");
  const [status, setStatus] = useState(plass?.status ?? "ledig");
  const [disponent, setDisponent] = useState(plass?.holderName ?? "");
  const [enhet, setEnhet] = useState(plass?.unitLabel ?? "");
  const [notater, setNotater] = useState(plass?.notes ?? "");
  const [bekreftSlett, setBekreftSlett] = useState(false);
  const { sender, feil, send } = useSending(onLagret);

  if (bekreftSlett && plass) {
    return (
      <Modal tittel="Slett plass" onLukk={() => setBekreftSlett(false)} bredde={380}>
        <p style={{ fontSize: "var(--fs-sm)", lineHeight: 1.6 }}>Slette plass {plass.number}?</p>
        <Knapperad
          onAvbryt={() => setBekreftSlett(false)}
          sendEtikett="Slett"
          farlig
          sender={sender}
          onSend={() => void send(() => parkering.slettPlass(orgId, plass.id))}
        />
      </Modal>
    );
  }

  return (
    <Modal
      tittel={plass ? `Rediger plass ${plass.number}` : "Registrer ny plass"}
      onLukk={onLukk}
      bredde={480}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const kropp = {
            number: nummer.trim(),
            areaLabel: omrade.trim() || null,
            ownershipType: eierskap,
            spotType: type,
            status,
            holderName: disponent.trim() || null,
            unitLabel: enhet.trim() || null,
            notes: notater.trim() || null,
          };
          void send(() =>
            plass ? parkering.endrePlass(orgId, plass.id, kropp) : parkering.nyPlass(orgId, kropp),
          );
        }}
      >
        {feil && <div className="feilmelding">{feil}</div>}
        <div className="field-row">
          <Tekstfelt etikett="Plassnummer *" verdi={nummer} onEndre={setNummer} plassholder="F.eks. P-01" />
          <Tekstfelt etikett="Område" verdi={omrade} onEndre={setOmrade} plassholder="F.eks. Kjeller 1" />
        </div>
        <div className="field-row">
          <Nedtrekk
            etikett="Eierskap"
            verdi={eierskap}
            onEndre={setEierskap}
            valg={Object.entries(EIERSKAP_INFO).map(([verdi, i]) => ({ verdi, etikett: i.etikett }))}
          />
          <Nedtrekk
            etikett="Type"
            verdi={type}
            onEndre={setType}
            valg={Object.entries(PLASSTYPE).map(([verdi, t]) => ({ verdi, etikett: `${t.ikon} ${t.etikett}` }))}
          />
        </div>
        <div className="field-row">
          <Tekstfelt etikett="Disponent" verdi={disponent} onEndre={setDisponent} plassholder="Navn (valgfritt)" />
          <Tekstfelt etikett="Tilhører enhet" verdi={enhet} onEndre={setEnhet} plassholder="F.eks. Seksjon 12" />
        </div>
        <Nedtrekk
          etikett="Status"
          verdi={status}
          onEndre={setStatus}
          valg={Object.entries(STATUS).map(([verdi, s]) => ({ verdi, etikett: s.etikett }))}
          notat="«Utleid» settes automatisk når en leieavtale opprettes for plassen."
        />
        <Tekstomrade etikett="Notater" verdi={notater} onEndre={setNotater} rader={2} />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px" }}>
          {plass ? (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ color: "var(--danger)" }}
              onClick={() => setBekreftSlett(true)}
            >
              Slett plass
            </button>
          ) : (
            <span />
          )}
          <Knapperad
            onAvbryt={onLukk}
            sendEtikett={plass ? "Lagre endringer" : "Registrer plass"}
            sender={sender}
            deaktivert={!nummer.trim()}
          />
        </div>
      </form>
    </Modal>
  );
}

function AvtaleModal({
  orgId,
  plasser,
  onLukk,
  onLagret,
}: {
  orgId: string;
  plasser: Plass[];
  onLukk: () => void;
  onLagret: () => void;
}) {
  // Bare ledige FELLESEIDE plasser kan leies ut — tinglyste og seksjonerte er ikke styrets.
  const ledige = plasser.filter((p) => !p.lease && p.ownershipType === "felles");
  const [plassId, setPlassId] = useState(ledige[0]?.id ?? "");
  const [leietaker, setLeietaker] = useState("");
  const [pris, setPris] = useState("");
  const [oppsigelse, setOppsigelse] = useState("1");
  const [start, setStart] = useState("");
  const [slutt, setSlutt] = useState("");
  const { sender, feil, send } = useSending(onLagret);

  return (
    <Modal tittel="Ny leieavtale" onLukk={onLukk} bredde={460}>
      {ledige.length === 0 ? (
        <>
          <p style={{ fontSize: "var(--fs-sm)", color: "var(--muted)" }}>
            Ingen ledige felleseide plasser å leie ut for øyeblikket. Tinglyste og
            seksjonerte plasser disponeres ikke av styret.
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button className="btn btn-ghost" onClick={onLukk}>Lukk</button>
          </div>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(() =>
              parkering.nyAvtale(orgId, {
                spotId: plassId,
                tenantName: leietaker.trim(),
                pricePerMonth: Number(pris),
                startDate: start || null,
                endDate: slutt || null,
                noticePeriodMonths: oppsigelse === "" ? null : Number(oppsigelse),
              }),
            );
          }}
        >
          {feil && <div className="feilmelding">{feil}</div>}
          <Nedtrekk
            etikett="Plass *"
            verdi={plassId}
            onEndre={setPlassId}
            valg={ledige.map((p) => ({
              verdi: p.id,
              etikett: `${p.number}${p.areaLabel ? ` — ${p.areaLabel}` : ""}`,
            }))}
          />
          <Tekstfelt etikett="Leietaker *" verdi={leietaker} onEndre={setLeietaker} plassholder="Navn" />
          <div className="field-row">
            <Tekstfelt etikett="Pris kr/mnd *" type="number" verdi={pris} onEndre={setPris} />
            <Tekstfelt etikett="Oppsigelsestid (mnd)" type="number" verdi={oppsigelse} onEndre={setOppsigelse} />
          </div>
          <div className="field-row">
            <Tekstfelt etikett="Startdato" type="date" verdi={start} onEndre={setStart} />
            <Tekstfelt
              etikett="Sluttdato"
              type="date"
              verdi={slutt}
              onEndre={setSlutt}
              notat="La stå tom for løpende avtale."
            />
          </div>
          <Knapperad
            onAvbryt={onLukk}
            sendEtikett="Opprett leieavtale"
            sender={sender}
            deaktivert={!plassId || !leietaker.trim() || !pris}
          />
        </form>
      )}
    </Modal>
  );
}

function VentelisteModal({
  orgId,
  onLukk,
  onLagret,
}: {
  orgId: string;
  onLukk: () => void;
  onLagret: () => void;
}) {
  const [navn, setNavn] = useState("");
  const [type, setType] = useState("standard");
  const [ventetSiden, setVentetSiden] = useState("");
  const [notater, setNotater] = useState("");
  const { sender, feil, send } = useSending(onLagret);

  return (
    <Modal tittel="Legg til på venteliste" onLukk={onLukk} bredde={420}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(() =>
            parkering.nyVentende(orgId, {
              name: navn.trim(),
              requestedType: type,
              ...(ventetSiden ? { requestedAt: ventetSiden } : {}),
              notes: notater.trim() || null,
            }),
          );
        }}
      >
        {feil && <div className="feilmelding">{feil}</div>}
        <Tekstfelt etikett="Navn *" verdi={navn} onEndre={setNavn} />
        <Nedtrekk
          etikett="Ønsket type"
          verdi={type}
          onEndre={setType}
          valg={Object.entries(PLASSTYPE).map(([verdi, t]) => ({ verdi, etikett: `${t.ikon} ${t.etikett}` }))}
        />
        <Tekstfelt
          etikett="Ventet siden"
          type="date"
          verdi={ventetSiden}
          onEndre={setVentetSiden}
          notat="La stå tom for å bruke dagens dato."
        />
        <Tekstomrade etikett="Notater" verdi={notater} onEndre={setNotater} rader={2} />
        <Knapperad onAvbryt={onLukk} sendEtikett="Legg til" sender={sender} deaktivert={!navn.trim()} />
      </form>
    </Modal>
  );
}
