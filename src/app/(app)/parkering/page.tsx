"use client";

import { useMemo, useState } from "react";
import Layout from "@/components/Layout";
import { Faner, Feil, Tom, dato, dagerSiden, useOrgData } from "@/components/felles";
import { Knapperad, Nedtrekk, Skuff, Tekstfelt, Tekstomrade, useSending } from "@/components/skjema";
import { useOkt } from "@/components/OktProvider";
import { parkering, type Parkeringsavtale, type Plass, type Ventende } from "@/lib/klient";

/**
 * Parkering — etter `mockups/parkering-mockup.html`: faner med tellere, kompakt
 * nøkkeltallstripe, plasstabell med detaljskuff, serieoppretting fra tom tilstand,
 * leieavtaler MED historikk (avsluttede beholdes), og venteliste med tildeling som
 * fjerner oppføringen i samme operasjon.
 *
 * Bevisst utelatt fra mockupen: ladeanlegg-integrasjon (Easee/Zaptec med effekt, kWh og
 * månedsavregning — krever API-avtaler som ikke finnes), e-signering av avtaler, og
 * regneark-import. Lading-fanen viser det som er sant: hvilke plasser som har ladepunkt.
 */

const EIERSKAP_INFO: Record<string, { etikett: string; farge: string; bg: string; forklaring: string }> = {
  tinglyst: {
    etikett: "Tinglyst",
    farge: "#8b5cf6",
    bg: "rgba(139, 92, 246, 0.1)",
    forklaring: "Følger boenheten permanent. Retten er tinglyst på seksjonen, og styret kan verken tildele eller leie ut plassen.",
  },
  seksjon: {
    etikett: "Egen seksjon",
    farge: "var(--accent)",
    bg: "rgba(var(--accent-rgb), 0.1)",
    forklaring: "Selvstendig eiendom, kjøpt separat av eier. Kan selges videre uavhengig av leiligheten. Styret disponerer ikke.",
  },
  felles: {
    etikett: "Felleseie",
    farge: "#0fba81",
    bg: "rgba(15, 186, 129, 0.1)",
    forklaring: "Eies av sameiet eller laget. Styret fordeler eller leier ut, normalt etter venteliste. Dette er plassene leieavtaler gjelder for.",
  },
};

const TYPE_ETIKETT: Record<string, string> = { standard: "Vanlig", hc: "Bred (HC)", mc: "MC", gjest: "Gjest", lading: "Vanlig" };
const ONSKE_ETIKETT: Record<string, string> = {
  standard: "Vanlig plass",
  lading: "Ladeplass",
  hc: "HC-plass",
  mc: "MC-plass",
  gjest: "Gjesteplass",
};
const STATUS_INFO: Record<string, { etikett: string; merke: string }> = {
  disponert: { etikett: "Disponert", merke: "muted" },
  ledig: { etikett: "Ledig", merke: "ok" },
  utleid: { etikett: "Utleid", merke: "info" },
  reservert: { etikett: "Reservert", merke: "warn" },
};
const STROM_ETIKETT: Record<string, string> = {
  forbruk: "Viderefaktureres etter faktisk forbruk",
  inkludert: "Inkludert i leien",
  fast: "Fast tillegg per måned",
};

type Fane = "plasser" | "avtaler" | "venteliste" | "lading";
type PlassFilter = "alle" | "tinglyst" | "seksjon" | "felles" | "lading" | "ledig";
type AvtaleFilter = "aktive" | "utloper" | "avsluttede";

/** Under 60 dager igjen — eller allerede passert uten at avtalen er avsluttet. */
const utloperSnart = (a: Parkeringsavtale) =>
  !a.endedAt && a.endDate !== null && (dagerSiden(a.endDate) ?? -999) >= -60;

export default function Parkering() {
  const { aktivOrg } = useOkt();
  const kanEndre = aktivOrg?.nivaa === "orgadmin" || aktivOrg?.nivaa === "redigering";

  const [fane, setFane] = useState<Fane>("plasser");
  const [filter, setFilter] = useState<PlassFilter>("alle");
  const [avtaleFilter, setAvtaleFilter] = useState<AvtaleFilter>("aktive");
  const [sok, setSok] = useState("");

  // Skuffene. Én av gangen — de dekker hverandre uansett.
  const [detalj, setDetalj] = useState<Plass | null>(null);
  const [rediger, setRediger] = useState<Plass | "ny" | null>(null);
  const [serie, setSerie] = useState(false);
  const [avtaleSkuff, setAvtaleSkuff] = useState<{ plassId?: string; ventende?: Ventende } | null>(null);
  const [ventendeSkuff, setVentendeSkuff] = useState(false);
  const [hjelp, setHjelp] = useState(false);

  const { data, feil, setFeil, laster, last, orgId } = useOrgData(async (o) => {
    const [plasser, avtaler, venteliste] = await Promise.all([
      parkering.plasser(o),
      parkering.avtaler(o),
      parkering.venteliste(o),
    ]);
    return { plasser, avtaler, venteliste };
  });

  const plasser = useMemo(() => data?.plasser ?? [], [data]);
  const avtaler = useMemo(() => data?.avtaler ?? [], [data]);
  const venteliste = useMemo(() => data?.venteliste ?? [], [data]);
  const aktiveAvtaler = avtaler.filter((a) => !a.endedAt);
  const plassMedId = new Map(plasser.map((p) => [p.id, p]));

  async function utfor(fn: () => Promise<unknown>, ellers: string) {
    setFeil(null);
    try {
      await fn();
      await last();
      return true;
    } catch (e) {
      setFeil(e instanceof Error ? e.message : ellers);
      return false;
    }
  }

  /* ── Nøkkeltall ── */
  const medLading = plasser.filter((p) => p.hasCharger).length;
  const ledige = plasser.filter((p) => p.status === "ledig").length;
  const leieinntekt = aktiveAvtaler.reduce((n, a) => n + a.pricePerMonth, 0);

  const synligePlasser = plasser.filter((p) => {
    if (filter === "lading" && !p.hasCharger) return false;
    if (filter === "ledig" && p.status !== "ledig") return false;
    if ((filter === "tinglyst" || filter === "seksjon" || filter === "felles") && p.ownershipType !== filter) return false;
    if (sok.trim()) {
      const q = sok.trim().toLowerCase();
      return `${p.number} ${p.holderName ?? ""} ${p.unitLabel ?? ""}`.toLowerCase().includes(q);
    }
    return true;
  });

  const synligeAvtaler = avtaler.filter((a) =>
    avtaleFilter === "aktive" ? !a.endedAt : avtaleFilter === "utloper" ? utloperSnart(a) : Boolean(a.endedAt),
  );
  const antallUtloper = avtaler.filter(utloperSnart).length;

  const ladeplasser = plasser.filter((p) => p.hasCharger);

  const eierskapPill = (type: string) => {
    const info = EIERSKAP_INFO[type] ?? { etikett: type, farge: "var(--muted)", bg: "var(--surface2)" };
    return (
      <span className="prk-pill" style={{ background: info.bg, color: info.farge }}>
        {info.etikett}
      </span>
    );
  };

  return (
    <Layout
      tittel="Parkering"
      subnav={
        <Faner
          valgt={fane}
          onVelg={setFane}
          faner={[
            { nokkel: "plasser", etikett: `Plasser · ${plasser.length}` },
            { nokkel: "avtaler", etikett: `Leieavtaler · ${aktiveAvtaler.length}` },
            { nokkel: "venteliste", etikett: `Venteliste · ${venteliste.length}` },
            { nokkel: "lading", etikett: `Lading · ${medLading}` },
          ]}
        />
      }
      handlinger={
        <>
          <button className="btn btn-ghost" onClick={() => setHjelp(true)}>
            Eierskapstyper
          </button>
          {kanEndre && fane === "plasser" && (
            <button className="btn btn-primary" onClick={() => setRediger("ny")}>
              Registrer plass
            </button>
          )}
          {kanEndre && fane === "avtaler" && (
            <button className="btn btn-primary" onClick={() => setAvtaleSkuff({})}>
              Ny leieavtale
            </button>
          )}
          {kanEndre && fane === "venteliste" && (
            <button className="btn btn-primary" onClick={() => setVentendeSkuff(true)}>
              Legg til på venteliste
            </button>
          )}
        </>
      }
    >
      <div className="page-content">
        <Feil melding={feil} />

        {laster && !data ? (
          <Tom tekst="Henter …" />
        ) : plasser.length === 0 && fane === "plasser" ? (
          /* Tom tilstand: to veier inn — én plass, eller hele serien på én gang. */
          <div className="card">
            <div style={{ textAlign: "center", padding: "44px 24px" }}>
              <h2 style={{ margin: "0 0 6px", fontSize: "var(--fs-md)", fontWeight: 700 }}>
                Ingen plasser er registrert ennå
              </h2>
              <p className="pf-dempet" style={{ maxWidth: "52ch", margin: "0 auto 22px" }}>
                Legg inn plassene én gang, så følger de bygget videre. Etterpå kan du
                tildele plasser, lage leieavtaler og føre venteliste.
              </p>
              {kanEndre && (
                <div className="prk-veier">
                  <button className="prk-vei" onClick={() => setRediger("ny")}>
                    <span className="n">1</span>
                    <span style={{ display: "block", fontWeight: 600 }}>Registrer én plass</span>
                    <span style={{ display: "block", color: "var(--muted)", fontSize: "var(--fs-label)", marginTop: "3px" }}>
                      Fint hvis dere har få plasser, eller vil se hvordan det fungerer først.
                    </span>
                  </button>
                  <button className="prk-vei" onClick={() => setSerie(true)}>
                    <span className="n">2</span>
                    <span style={{ display: "block", fontWeight: 600 }}>Opprett en serie</span>
                    <span style={{ display: "block", color: "var(--muted)", fontSize: "var(--fs-label)", marginTop: "3px" }}>
                      Lag P01 til P24 på én gang, og fyll inn disponenter etterpå.
                    </span>
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="prk-stripe">
              <div className="prk-stripe-del">
                <div className="k">Plasser</div>
                <div className="v">
                  {plasser.length} <small>hvorav {medLading} med lading</small>
                </div>
              </div>
              <div className="prk-stripe-del">
                <div className="k">Disponert</div>
                <div className="v">{plasser.length - ledige}</div>
              </div>
              <div className="prk-stripe-del">
                <div className="k">Ledige</div>
                <div className="v gronn">
                  {ledige} <small>kan tildeles</small>
                </div>
              </div>
              <div className="prk-stripe-del">
                <div className="k">På venteliste</div>
                <div className="v gul">{venteliste.length}</div>
              </div>
              <div className="prk-stripe-del">
                <div className="k">Leieinntekt</div>
                <div className="v">
                  {leieinntekt.toLocaleString("nb-NO")} <small>kr/mnd</small>
                </div>
              </div>
            </div>

            {fane === "plasser" && (
              <>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                  {(
                    [
                      ["alle", "Alle"],
                      ["tinglyst", "Tinglyst"],
                      ["seksjon", "Egen seksjon"],
                      ["felles", "Felleseie"],
                      ["lading", "Med lading"],
                      ["ledig", "Ledige"],
                    ] as Array<[PlassFilter, string]>
                  ).map(([f, etikett]) => (
                    <button
                      key={f}
                      className={`pille${filter === f ? " valgt" : ""}`}
                      onClick={() => setFilter(f)}
                    >
                      {etikett}
                    </button>
                  ))}
                  <input
                    className="input sok-hoyre"
                    placeholder="Søk plassnummer eller navn"
                    aria-label="Søk i plasser"
                    value={sok}
                    onChange={(e) => setSok(e.target.value)}
                  />
                </div>

                <div className="card" style={{ overflow: "hidden" }}>
                  <div className="prk-scroll">
                    <div className="prk-min">
                      <div className="prk-hode prk-plass">
                        <span>Plass</span><span>Eierskap</span><span>Disponent</span><span>Type</span><span>Lading</span><span style={{ textAlign: "right" }}>Status</span>
                      </div>
                      {synligePlasser.length === 0 ? (
                        <Tom tekst="Ingen plasser passer filteret." />
                      ) : (
                        synligePlasser.map((p) => {
                          const st = STATUS_INFO[p.status] ?? { etikett: p.status, merke: "muted" };
                          return (
                            <button
                              key={p.id}
                              className="prk-rad prk-plass"
                              style={{ width: "100%", background: "none", border: "none", borderBottom: "1px solid var(--border)", textAlign: "left", cursor: "pointer", color: "var(--text)", fontFamily: "var(--font-sans)", fontSize: "var(--fs-sm)" }}
                              onClick={() => setDetalj(p)}
                            >
                              <span className="prk-nr">{p.number}</span>
                              <span>{eierskapPill(p.ownershipType)}</span>
                              <span style={{ minWidth: 0 }}>
                                {p.holderName || p.unitLabel ? (
                                  <>
                                    <span className="list-tittel">
                                      {[p.unitLabel, p.holderName].filter(Boolean).join(", ")}
                                    </span>
                                    {p.lease && <span className="list-meta">leier for {p.lease.pricePerMonth} kr/mnd</span>}
                                  </>
                                ) : (
                                  <span style={{ color: "var(--muted)" }}>Ingen</span>
                                )}
                              </span>
                              <span style={{ color: "var(--muted)", fontSize: "var(--fs-label)" }}>
                                {TYPE_ETIKETT[p.spotType] ?? p.spotType}
                              </span>
                              <span style={{ fontSize: "var(--fs-label)" }}>
                                {p.hasCharger ? (
                                  <span style={{ color: "var(--warn)" }}>⚡ {p.chargerLabel || "Ladepunkt"}</span>
                                ) : (
                                  <span style={{ color: "var(--muted)" }}>Nei</span>
                                )}
                              </span>
                              <span style={{ display: "flex", justifyContent: "flex-end" }}>
                                <span className={`badge ${st.merke}`}>{st.etikett}</span>
                              </span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
                <div className="prk-note">
                  Plasser med eierskapstypen <b>Tinglyst</b> eller <b>Egen seksjon</b> kan
                  ikke tildeles av styret. De vises for oversiktens skyld, men er ikke en del
                  av det styret disponerer.
                </div>
              </>
            )}

            {fane === "avtaler" && (
              <>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  {(
                    [
                      ["aktive", `Aktive (${aktiveAvtaler.length})`],
                      ["utloper", `Utløper snart (${antallUtloper})`],
                      ["avsluttede", `Avsluttede (${avtaler.length - aktiveAvtaler.length})`],
                    ] as Array<[AvtaleFilter, string]>
                  ).map(([f, etikett]) => (
                    <button
                      key={f}
                      className={`pille${avtaleFilter === f ? " valgt" : ""}`}
                      onClick={() => setAvtaleFilter(f)}
                    >
                      {etikett}
                    </button>
                  ))}
                </div>

                <div className="card" style={{ overflow: "hidden" }}>
                  <div className="prk-scroll">
                    <div className="prk-min">
                      <div className="prk-hode prk-avtale">
                        <span>Leietaker</span><span>Plass</span><span>Periode</span><span style={{ textAlign: "right" }}>Pris/mnd</span><span />
                      </div>
                      {synligeAvtaler.length === 0 ? (
                        <Tom tekst="Ingen avtaler i dette filteret." />
                      ) : (
                        synligeAvtaler.map((a) => (
                          <div key={a.id} className="prk-rad prk-avtale">
                            <span style={{ minWidth: 0 }}>
                              <span className="list-tittel">{a.tenantName}</span>
                              <span className="list-meta">
                                {a.endedAt
                                  ? `Avsluttet ${dato(a.endedAt)}`
                                  : a.powerBilling
                                    ? `Strøm: ${STROM_ETIKETT[a.powerBilling] ?? a.powerBilling}`
                                    : ""}
                              </span>
                            </span>
                            <span className="prk-nr" style={{ width: "60px" }}>
                              {plassMedId.get(a.spotId)?.number ?? "—"}
                            </span>
                            <span className="list-meta">
                              {dato(a.startDate)} – {a.endDate ? dato(a.endDate) : "løpende"}
                              {a.noticePeriodMonths ? ` · oppsigelse ${a.noticePeriodMonths} mnd` : ""}
                            </span>
                            <span style={{ textAlign: "right", fontWeight: 700, fontSize: "var(--fs-sm)" }}>
                              {a.pricePerMonth.toLocaleString("nb-NO")} kr
                            </span>
                            <span style={{ display: "flex", justifyContent: "flex-end" }}>
                              {kanEndre && !a.endedAt && (
                                <button
                                  className="btn btn-ghost"
                                  style={{ color: "var(--danger)" }}
                                  onClick={() =>
                                    void utfor(() => parkering.avsluttAvtale(orgId!, a.id), "Kunne ikke avslutte avtalen")
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
                {antallUtloper > 0 && (
                  <div className="prk-note gul">
                    {antallUtloper} {antallUtloper === 1 ? "avtale løper" : "avtaler løper"} ut
                    innen 60 dager. <b>Sjekk oppsigelsesfristen</b> og send beskjed nå hvis
                    plassen skal ut på nytt.
                  </div>
                )}
              </>
            )}

            {fane === "venteliste" && (
              <div className="card" style={{ overflow: "hidden" }}>
                <div className="card-header">
                  <div>
                    <div className="card-title">Venteliste</div>
                    <div className="field-note">
                      Sortert etter dato, eldste først. Rekkefølgen er dokumentert, slik at
                      tildelingen kan begrunnes i ettertid.
                    </div>
                  </div>
                </div>
                <div className="prk-scroll">
                  <div className="prk-min">
                    <div className="prk-hode prk-vente">
                      <span>Nr.</span><span>Navn</span><span>Ønsker</span><span>På listen siden</span><span />
                    </div>
                    {venteliste.length === 0 ? (
                      <Tom tekst="Ingen står på venteliste." />
                    ) : (
                      venteliste.map((v, i) => (
                        <div key={v.id} className="prk-rad prk-vente">
                          <span className="prk-posisjon">{i + 1}</span>
                          <span style={{ minWidth: 0 }}>
                            <span className="list-tittel">
                              {[v.unitLabel, v.name].filter(Boolean).join(", ")}
                            </span>
                            {v.notes && <span className="list-meta">{v.notes}</span>}
                          </span>
                          <span>
                            <span className="prk-pill" style={{ background: "var(--surface2)", color: v.requestedType === "lading" ? "var(--warn)" : "var(--accent)" }}>
                              {ONSKE_ETIKETT[v.requestedType] ?? v.requestedType}
                            </span>
                          </span>
                          <span className="list-meta">{dato(v.requestedAt)}</span>
                          <span style={{ display: "flex", justifyContent: "flex-end", gap: "6px" }}>
                            {kanEndre && (
                              <>
                                <button className="btn" onClick={() => setAvtaleSkuff({ ventende: v })}>
                                  Tildel plass
                                </button>
                                <button
                                  className="btn btn-ghost"
                                  style={{ color: "var(--danger)" }}
                                  onClick={() =>
                                    void utfor(() => parkering.slettVentende(orgId!, v.id), "Kunne ikke fjerne fra ventelisten")
                                  }
                                >
                                  Fjern
                                </button>
                              </>
                            )}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}

            {fane === "lading" && (
              <>
                <div className="card" style={{ overflow: "hidden" }}>
                  <div className="card-header">
                    <div>
                      <div className="card-title">Ladepunkter</div>
                      <div className="field-note">Plassene som har ladepunkt registrert.</div>
                    </div>
                  </div>
                  <div className="prk-scroll">
                    <div className="prk-min">
                      <div className="prk-hode prk-vente">
                        <span>Plass</span><span>Ladepunkt</span><span>Disponent</span><span>Status</span><span />
                      </div>
                      {ladeplasser.length === 0 ? (
                        <Tom tekst="Ingen plasser har ladepunkt registrert. Sett «Ladepunkt» på plassen." />
                      ) : (
                        ladeplasser.map((p) => {
                          const st = STATUS_INFO[p.status] ?? { etikett: p.status, merke: "muted" };
                          return (
                            <div key={p.id} className="prk-rad prk-vente">
                              <span className="prk-nr" style={{ width: "60px" }}>{p.number}</span>
                              <span style={{ color: "var(--warn)", fontSize: "var(--fs-label)" }}>
                                ⚡ {p.chargerLabel || "Ladepunkt"}
                              </span>
                              <span style={{ minWidth: 0 }}>
                                {[p.unitLabel, p.holderName].filter(Boolean).join(", ") || (
                                  <span style={{ color: "var(--muted)" }}>Ingen</span>
                                )}
                              </span>
                              <span><span className={`badge ${st.merke}`}>{st.etikett}</span></span>
                              <span style={{ display: "flex", justifyContent: "flex-end" }}>
                                <button className="btn btn-ghost" onClick={() => setDetalj(p)}>Åpne</button>
                              </span>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
                <div className="prk-note">
                  Kobling mot ladeanlegg (Easee, Zaptec) med status, forbruk og
                  månedsavregning er <b>ikke bygget ennå</b> — kWh må inntil videre leses av
                  og avregnes manuelt. Si fra hvilke anlegg dere har, så prioriteres riktig
                  integrasjon.
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* ── Skuffene ── */}

      {detalj && (
        <PlassDetalj
          plass={detalj}
          kanEndre={kanEndre}
          onLukk={() => setDetalj(null)}
          onRediger={() => {
            setDetalj(null);
            setRediger(detalj);
          }}
          onLagAvtale={() => {
            setDetalj(null);
            setAvtaleSkuff({ plassId: detalj.id });
          }}
          onSeAvtale={() => {
            setDetalj(null);
            setFane("avtaler");
            setAvtaleFilter("aktive");
          }}
          onSiOpp={async () => {
            const aktiv = avtaler.find((a) => a.spotId === detalj.id && !a.endedAt);
            if (!aktiv) return;
            if (await utfor(() => parkering.avsluttAvtale(orgId!, aktiv.id), "Kunne ikke avslutte avtalen")) {
              setDetalj(null);
            }
          }}
        />
      )}

      {rediger && orgId && (
        <PlassSkjemaSkuff
          orgId={orgId}
          plass={rediger === "ny" ? null : rediger}
          onLukk={() => setRediger(null)}
          onLagret={(fortsett) => {
            void last();
            if (!fortsett) setRediger(null);
          }}
        />
      )}

      {serie && orgId && (
        <SerieSkuff
          orgId={orgId}
          onLukk={() => setSerie(false)}
          onLagret={() => {
            setSerie(false);
            void last();
          }}
        />
      )}

      {avtaleSkuff && orgId && (
        <AvtaleSkuff
          orgId={orgId}
          plasser={plasser}
          forhandsvalgtPlassId={avtaleSkuff.plassId}
          ventende={avtaleSkuff.ventende}
          onLukk={() => setAvtaleSkuff(null)}
          onLagret={() => {
            setAvtaleSkuff(null);
            void last();
          }}
        />
      )}

      {ventendeSkuff && orgId && (
        <VentendeSkuff
          orgId={orgId}
          onLukk={() => setVentendeSkuff(false)}
          onLagret={() => {
            setVentendeSkuff(false);
            void last();
          }}
        />
      )}

      {hjelp && (
        <Skuff tittel="Eierskapstyper" onLukk={() => setHjelp(false)}>
          <p className="field-note" style={{ marginTop: 0 }}>Hva styret kan og ikke kan disponere.</p>
          <div className="prk-hjelp">
            {Object.values(EIERSKAP_INFO).map((info) => (
              <div key={info.etikett} className="r">
                <span className="sw" style={{ background: info.farge }} aria-hidden />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontWeight: 600, fontSize: "var(--fs-sm)" }}>{info.etikett}</span>
                  <span style={{ display: "block", color: "var(--muted)", fontSize: "var(--fs-label)" }}>{info.forklaring}</span>
                </span>
              </div>
            ))}
          </div>
          <div className="prk-note">
            Skillet betyr noe juridisk: en tinglyst plass kan ikke omfordeles selv om
            beboeren ikke har bil. Det er den vanligste kilden til konflikt i
            parkeringssaker.
          </div>
        </Skuff>
      )}
    </Layout>
  );
}

/* ── Skuffkomponentene ─────────────────────────────────────────────────────────────────── */

function PlassDetalj({
  plass,
  kanEndre,
  onLukk,
  onRediger,
  onLagAvtale,
  onSeAvtale,
  onSiOpp,
}: {
  plass: Plass;
  kanEndre: boolean;
  onLukk: () => void;
  onRediger: () => void;
  onLagAvtale: () => void;
  onSeAvtale: () => void;
  onSiOpp: () => Promise<void>;
}) {
  const [bekreftOppsigelse, setBekreftOppsigelse] = useState(false);
  const eier = EIERSKAP_INFO[plass.ownershipType];
  const st = STATUS_INFO[plass.status] ?? { etikett: plass.status, merke: "muted" };
  const erFelles = plass.ownershipType === "felles";

  return (
    <Skuff tittel={`Plass ${plass.number}`} onLukk={onLukk}>
      <dl style={{ margin: 0 }}>
        <div className="prk-par">
          <dt>Eierskap</dt>
          <dd>
            <span className="prk-pill" style={{ background: eier?.bg ?? "var(--surface2)", color: eier?.farge ?? "var(--muted)" }}>
              {eier?.etikett ?? plass.ownershipType}
            </span>
          </dd>
        </div>
        <div className="prk-par">
          <dt>Disponent</dt>
          <dd>{[plass.unitLabel, plass.holderName].filter(Boolean).join(", ") || "Ingen"}</dd>
        </div>
        <div className="prk-par"><dt>Plassering</dt><dd>{plass.areaLabel ?? "—"}</dd></div>
        <div className="prk-par"><dt>Type</dt><dd>{TYPE_ETIKETT[plass.spotType] ?? plass.spotType}</dd></div>
        <div className="prk-par">
          <dt>Ladepunkt</dt>
          <dd>{plass.hasCharger ? plass.chargerLabel || "Ja" : "Nei"}</dd>
        </div>
        {plass.lease && (
          <div className="prk-par">
            <dt>Leies av</dt>
            <dd>{plass.lease.tenantName} · {plass.lease.pricePerMonth} kr/mnd</dd>
          </div>
        )}
        <div className="prk-par">
          <dt>Status</dt>
          <dd><span className={`badge ${st.merke}`}>{st.etikett}</span></dd>
        </div>
        {plass.notes && <div className="prk-par"><dt>Notater</dt><dd>{plass.notes}</dd></div>}
      </dl>

      {kanEndre && (
        <div style={{ marginTop: "18px", display: "flex", flexDirection: "column", gap: "8px" }}>
          {erFelles ? (
            plass.status === "ledig" ? (
              <button className="btn btn-primary" onClick={onLagAvtale}>Lag leieavtale</button>
            ) : plass.lease ? (
              bekreftOppsigelse ? (
                <div className="prk-note gul" style={{ marginTop: 0 }}>
                  Avslutte leieforholdet med <b>{plass.lease.tenantName}</b>? Plassen settes
                  til ledig, og avtalen legges i historikken.
                  <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
                    <button className="btn btn-ghost" onClick={() => setBekreftOppsigelse(false)}>Avbryt</button>
                    <button className="btn" style={{ color: "var(--danger)" }} onClick={() => void onSiOpp()}>
                      Bekreft oppsigelse
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button className="btn" onClick={onSeAvtale}>Se leieavtalene</button>
                  <button className="btn" style={{ color: "var(--danger)" }} onClick={() => setBekreftOppsigelse(true)}>
                    Si opp avtalen
                  </button>
                </>
              )
            ) : null
          ) : (
            <div className="prk-note" style={{ marginTop: 0 }}>
              Plassen er {eier?.etikett.toLowerCase()} og disponeres ikke av styret. Den kan
              ikke tildeles eller leies ut herfra.
            </div>
          )}
          <button className="btn btn-ghost" onClick={onRediger}>Rediger plassen</button>
        </div>
      )}
    </Skuff>
  );
}

function PlassSkjemaSkuff({
  orgId,
  plass,
  onLukk,
  onLagret,
}: {
  orgId: string;
  plass: Plass | null;
  onLukk: () => void;
  onLagret: (fortsett: boolean) => void;
}) {
  const [nummer, setNummer] = useState(plass?.number ?? "");
  const [omrade, setOmrade] = useState(plass?.areaLabel ?? "");
  const [eierskap, setEierskap] = useState(plass?.ownershipType ?? "felles");
  const [type, setType] = useState(plass?.spotType ?? "standard");
  const [status, setStatus] = useState(plass?.status ?? "ledig");
  const [enhet, setEnhet] = useState(plass?.unitLabel ?? "");
  const [disponent, setDisponent] = useState(plass?.holderName ?? "");
  const [lading, setLading] = useState(plass?.hasCharger ?? false);
  const [ladepunkt, setLadepunkt] = useState(plass?.chargerLabel ?? "");
  const [notater, setNotater] = useState(plass?.notes ?? "");
  const [bekreftSlett, setBekreftSlett] = useState(false);
  const [sender, setSender] = useState(false);
  const [feil, setFeil] = useState<string | null>(null);

  const eier = EIERSKAP_INFO[eierskap];

  // Egen flyt i stedet for useSending: «Lagre og legg til ny» må vite HVILKEN knapp som
  // ble trykket når kallet er ferdig, og en delt callback ser bare gammel state.
  async function lagre(leggTilNy: boolean) {
    setSender(true);
    setFeil(null);
    const kropp = {
      number: nummer.trim(),
      areaLabel: omrade.trim() || null,
      ownershipType: eierskap,
      spotType: type,
      status,
      holderName: disponent.trim() || null,
      unitLabel: enhet.trim() || null,
      hasCharger: lading,
      chargerLabel: lading ? ladepunkt.trim() || null : null,
      notes: notater.trim() || null,
    };
    try {
      await (plass ? parkering.endrePlass(orgId, plass.id, kropp) : parkering.nyPlass(orgId, kropp));
      onLagret(leggTilNy);
      if (leggTilNy) {
        setNummer("");
        setEnhet("");
        setDisponent("");
      }
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke lagre plassen");
    } finally {
      setSender(false);
    }
  }

  async function slett() {
    if (!plass) return;
    setSender(true);
    setFeil(null);
    try {
      await parkering.slettPlass(orgId, plass.id);
      onLagret(false);
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke slette plassen");
    } finally {
      setSender(false);
    }
  }

  return (
    <Skuff tittel={plass ? `Rediger plass ${plass.number}` : "Registrer plass"} onLukk={onLukk}>
      <p className="field-note" style={{ marginTop: 0 }}>
        Eierskapstypen avgjør om styret kan disponere plassen.
      </p>
      {feil && <div className="feilmelding">{feil}</div>}
      <div className="field-row">
        <Tekstfelt etikett="Plassnummer *" verdi={nummer} onEndre={setNummer} plassholder="P25" />
        <Tekstfelt etikett="Plassering" verdi={omrade} onEndre={setOmrade} plassholder="Garasje U1" />
      </div>
      <Nedtrekk
        etikett="Eierskapstype"
        verdi={eierskap}
        onEndre={setEierskap}
        valg={Object.entries(EIERSKAP_INFO).map(([verdi, i]) => ({ verdi, etikett: i.etikett }))}
      />
      {eier && (
        <div className="prk-hjelp" style={{ marginTop: 0, marginBottom: "12px" }}>
          <div className="r">
            <span className="sw" style={{ background: eier.farge }} aria-hidden />
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontWeight: 600, fontSize: "var(--fs-sm)" }}>{eier.etikett}</span>
              <span style={{ display: "block", color: "var(--muted)", fontSize: "var(--fs-label)" }}>{eier.forklaring}</span>
            </span>
          </div>
        </div>
      )}
      <div className="field-row">
        <Nedtrekk
          etikett="Type"
          verdi={type}
          onEndre={setType}
          valg={[
            { verdi: "standard", etikett: "Vanlig" },
            { verdi: "hc", etikett: "Bred (HC)" },
            { verdi: "mc", etikett: "MC" },
            { verdi: "gjest", etikett: "Gjest" },
          ]}
        />
        <Nedtrekk
          etikett="Status"
          verdi={status}
          onEndre={setStatus}
          valg={Object.entries(STATUS_INFO).map(([verdi, s]) => ({ verdi, etikett: s.etikett }))}
          notat="«Utleid» settes automatisk av leieavtalen."
        />
      </div>
      <div className="field-row">
        <Tekstfelt etikett="Tilhører enhet" verdi={enhet} onEndre={setEnhet} plassholder="H0301" />
        <Tekstfelt etikett="Disponent" verdi={disponent} onEndre={setDisponent} plassholder="Navn (valgfritt)" />
      </div>
      <div className="field-row">
        <Nedtrekk
          etikett="Ladepunkt"
          verdi={lading ? "ja" : "nei"}
          onEndre={(v) => setLading(v === "ja")}
          valg={[
            { verdi: "nei", etikett: "Ingen" },
            { verdi: "ja", etikett: "Har ladepunkt" },
          ]}
        />
        {lading ? (
          <Tekstfelt etikett="Anlegg" verdi={ladepunkt} onEndre={setLadepunkt} plassholder="Easee, garasjeanlegg U1" />
        ) : (
          <span />
        )}
      </div>
      <Tekstomrade etikett="Notater" verdi={notater} onEndre={setNotater} rader={2} />

      {bekreftSlett && plass ? (
        <div className="prk-note gul">
          Slette plass {plass.number} permanent?
          <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
            <button className="btn btn-ghost" onClick={() => setBekreftSlett(false)}>Avbryt</button>
            <button
              className="btn"
              style={{ color: "var(--danger)" }}
              disabled={sender}
              onClick={() => void slett()}
            >
              Bekreft sletting
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: "8px", justifyContent: "space-between", marginTop: "14px", flexWrap: "wrap" }}>
          {plass ? (
            <button className="btn btn-ghost" style={{ color: "var(--danger)" }} onClick={() => setBekreftSlett(true)}>
              Slett plass
            </button>
          ) : (
            <span />
          )}
          <div style={{ display: "flex", gap: "8px" }}>
            <button className="btn btn-ghost" onClick={onLukk}>Avbryt</button>
            {!plass && (
              <button className="btn" disabled={sender || !nummer.trim()} onClick={() => lagre(true)}>
                Lagre og legg til ny
              </button>
            )}
            <button className="btn btn-primary" disabled={sender || !nummer.trim()} onClick={() => lagre(false)}>
              {sender ? "Lagrer …" : plass ? "Lagre endringer" : "Lagre plass"}
            </button>
          </div>
        </div>
      )}
    </Skuff>
  );
}

function SerieSkuff({
  orgId,
  onLukk,
  onLagret,
}: {
  orgId: string;
  onLukk: () => void;
  onLagret: () => void;
}) {
  const [prefiks, setPrefiks] = useState("P");
  const [fra, setFra] = useState("1");
  const [til, setTil] = useState("24");
  const [omrade, setOmrade] = useState("");
  const [eierskap, setEierskap] = useState("felles");
  const [lading, setLading] = useState(false);
  const { sender, feil, send } = useSending(onLagret);

  const antall = Math.max(0, (parseInt(til, 10) || 0) - (parseInt(fra, 10) || 0) + 1);
  const eksempel = `${prefiks}${String(parseInt(fra, 10) || 0).padStart(2, "0")} – ${prefiks}${String(parseInt(til, 10) || 0).padStart(2, "0")}`;

  return (
    <Skuff tittel="Opprett en serie" onLukk={onLukk}>
      <p className="field-note" style={{ marginTop: 0 }}>
        Lager alle plassene på én gang, med samme eierskap og plassering. Disponenter og
        avvik fra malen fylles inn på hver plass etterpå.
      </p>
      {feil && <div className="feilmelding">{feil}</div>}
      <div className="field-row">
        <Tekstfelt etikett="Prefiks" verdi={prefiks} onEndre={setPrefiks} plassholder="P" />
        <Tekstfelt etikett="Plassering" verdi={omrade} onEndre={setOmrade} plassholder="Garasje U1" />
      </div>
      <div className="field-row">
        <Tekstfelt etikett="Fra nummer" type="number" verdi={fra} onEndre={setFra} />
        <Tekstfelt etikett="Til nummer" type="number" verdi={til} onEndre={setTil} />
      </div>
      <Nedtrekk
        etikett="Eierskapstype"
        verdi={eierskap}
        onEndre={setEierskap}
        valg={Object.entries(EIERSKAP_INFO).map(([verdi, i]) => ({ verdi, etikett: i.etikett }))}
        notat="Enkeltplasser kan endres etterpå — tinglyste unntak er normalen, ikke regelen."
      />
      <Nedtrekk
        etikett="Ladepunkt"
        verdi={lading ? "ja" : "nei"}
        onEndre={(v) => setLading(v === "ja")}
        valg={[
          { verdi: "nei", etikett: "Ingen" },
          { verdi: "ja", etikett: "Alle har ladepunkt" },
        ]}
      />
      <div className="prk-sammendrag">
        <div className="field-note" style={{ margin: 0 }}>
          {antall > 0 ? (
            <>Oppretter <b style={{ color: "var(--text)" }}>{antall} plasser</b>: {eksempel}. Kolliderer ett nummer med en eksisterende plass, opprettes ingen.</>
          ) : (
            "Serien slutter før den begynner."
          )}
        </div>
      </div>
      <Knapperad
        onAvbryt={onLukk}
        sendEtikett={`Opprett ${antall || ""} plasser`}
        sender={sender}
        deaktivert={antall === 0 || antall > 200}
        onSend={() =>
          void send(() =>
            parkering.nySerie(orgId, {
              prefiks: prefiks.trim(),
              fra: parseInt(fra, 10) || 0,
              til: parseInt(til, 10) || 0,
              minSifre: 2,
              areaLabel: omrade.trim() || null,
              ownershipType: eierskap,
              spotType: "standard",
              hasCharger: lading,
            }),
          )
        }
      />
    </Skuff>
  );
}

function AvtaleSkuff({
  orgId,
  plasser,
  forhandsvalgtPlassId,
  ventende,
  onLukk,
  onLagret,
}: {
  orgId: string;
  plasser: Plass[];
  forhandsvalgtPlassId?: string;
  ventende?: Ventende;
  onLukk: () => void;
  onLagret: () => void;
}) {
  // Bare ledige FELLESEIDE plasser kan leies ut — tinglyste og seksjonerte er ikke styrets.
  const ledige = plasser.filter((p) => !p.lease && p.ownershipType === "felles" && p.status === "ledig");
  const [plassId, setPlassId] = useState(forhandsvalgtPlassId ?? ledige[0]?.id ?? "");
  const [leietaker, setLeietaker] = useState(
    ventende ? [ventende.unitLabel, ventende.name].filter(Boolean).join(", ") : "",
  );
  const [pris, setPris] = useState("700");
  const [oppsigelse, setOppsigelse] = useState("1");
  const [start, setStart] = useState("");
  const [slutt, setSlutt] = useState("");
  const [strom, setStrom] = useState("forbruk");
  const { sender, feil, send } = useSending(onLagret);

  const valgtPlass = plasser.find((p) => p.id === plassId);
  const harLading = Boolean(valgtPlass?.hasCharger);

  return (
    <Skuff tittel="Ny leieavtale" onLukk={onLukk}>
      <p className="field-note" style={{ marginTop: 0 }}>
        Plassen settes til utleid når avtalen opprettes
        {ventende ? ", og leietakeren fjernes fra ventelisten" : ""}.
      </p>
      {feil && <div className="feilmelding">{feil}</div>}
      {ledige.length === 0 ? (
        <>
          <p style={{ fontSize: "var(--fs-sm)", color: "var(--muted)" }}>
            Ingen ledige felleseide plasser å leie ut for øyeblikket.
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button className="btn btn-ghost" onClick={onLukk}>Lukk</button>
          </div>
        </>
      ) : (
        <>
          {ventende && (
            <div className="prk-note" style={{ marginTop: 0, marginBottom: "12px" }}>
              <b>{ventende.name}</b> har stått på ventelisten siden {dato(ventende.requestedAt)}
              {" "}og ønsker {(ONSKE_ETIKETT[ventende.requestedType] ?? ventende.requestedType).toLowerCase()}.
            </div>
          )}
          <Nedtrekk
            etikett="Plass *"
            verdi={plassId}
            onEndre={setPlassId}
            valg={ledige.map((p) => ({
              verdi: p.id,
              etikett: `${p.number}${p.areaLabel ? `, ${p.areaLabel}` : ""}${p.hasCharger ? ", med lading" : ""}`,
            }))}
          />
          <Tekstfelt etikett="Leietaker *" verdi={leietaker} onEndre={setLeietaker} plassholder="H0301, Elin Vik" />
          <div className="field-row">
            <Tekstfelt etikett="Fra" type="date" verdi={start} onEndre={setStart} />
            <Tekstfelt etikett="Til" type="date" verdi={slutt} onEndre={setSlutt} notat="Tom = løpende avtale." />
          </div>
          <div className="field-row">
            <Tekstfelt etikett="Pris per måned *" type="number" verdi={pris} onEndre={setPris} />
            <Nedtrekk
              etikett="Oppsigelsesfrist"
              verdi={oppsigelse}
              onEndre={setOppsigelse}
              valg={[
                { verdi: "1", etikett: "1 måned" },
                { verdi: "2", etikett: "2 måneder" },
                { verdi: "3", etikett: "3 måneder" },
              ]}
            />
          </div>
          {harLading && (
            <Nedtrekk
              etikett="Strøm til lading"
              verdi={strom}
              onEndre={setStrom}
              valg={Object.entries(STROM_ETIKETT).map(([verdi, etikett]) => ({ verdi, etikett }))}
              notat="Dokumenterer hva avtalen sier — måling og avregning er ikke koblet til."
            />
          )}
          <div className="prk-sammendrag">
            <div className="field-note" style={{ margin: "0 0 6px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Slik blir avtalen
            </div>
            <dl style={{ margin: 0 }}>
              <div className="prk-par"><dt>Plass</dt><dd>{valgtPlass ? `${valgtPlass.number}${harLading ? ", med ladepunkt" : ""}` : "—"}</dd></div>
              <div className="prk-par"><dt>Leietaker</dt><dd>{leietaker || "—"}</dd></div>
              <div className="prk-par">
                <dt>Leie</dt>
                <dd>
                  {Number(pris) || 0} kr/mnd, {((Number(pris) || 0) * 12).toLocaleString("nb-NO")} kr i året
                </dd>
              </div>
              {harLading && <div className="prk-par"><dt>Strøm</dt><dd>{STROM_ETIKETT[strom]}</dd></div>}
              <div className="prk-par"><dt>Oppsigelse</dt><dd>{oppsigelse} mnd</dd></div>
              <div className="prk-par"><dt>Periode</dt><dd>{start ? dato(start) : "—"} – {slutt ? dato(slutt) : "løpende"}</dd></div>
            </dl>
          </div>
          <Knapperad
            onAvbryt={onLukk}
            sendEtikett="Opprett leieavtale"
            sender={sender}
            deaktivert={!plassId || !leietaker.trim() || !pris}
            onSend={() =>
              void send(() =>
                parkering.nyAvtale(orgId, {
                  spotId: plassId,
                  tenantName: leietaker.trim(),
                  pricePerMonth: Number(pris),
                  startDate: start || null,
                  endDate: slutt || null,
                  noticePeriodMonths: Number(oppsigelse),
                  powerBilling: harLading ? strom : null,
                  waitlistEntryId: ventende?.id ?? null,
                }),
              )
            }
          />
        </>
      )}
    </Skuff>
  );
}

function VentendeSkuff({
  orgId,
  onLukk,
  onLagret,
}: {
  orgId: string;
  onLukk: () => void;
  onLagret: () => void;
}) {
  const [navn, setNavn] = useState("");
  const [enhet, setEnhet] = useState("");
  const [type, setType] = useState("standard");
  const [siden, setSiden] = useState("");
  const [notater, setNotater] = useState("");
  const { sender, feil, send } = useSending(onLagret);

  return (
    <Skuff tittel="Legg til på venteliste" onLukk={onLukk}>
      {feil && <div className="feilmelding">{feil}</div>}
      <div className="field-row">
        <Tekstfelt etikett="Navn *" verdi={navn} onEndre={setNavn} />
        <Tekstfelt etikett="Enhet" verdi={enhet} onEndre={setEnhet} plassholder="H0301" />
      </div>
      <Nedtrekk
        etikett="Ønsker"
        verdi={type}
        onEndre={setType}
        valg={Object.entries(ONSKE_ETIKETT).map(([verdi, etikett]) => ({ verdi, etikett }))}
      />
      <Tekstfelt
        etikett="På listen siden"
        type="date"
        verdi={siden}
        onEndre={setSiden}
        notat="Tom = dagens dato."
      />
      <Tekstomrade etikett="Notater" verdi={notater} onEndre={setNotater} rader={2} />
      <Knapperad
        onAvbryt={onLukk}
        sendEtikett="Legg til"
        sender={sender}
        deaktivert={!navn.trim()}
        onSend={() =>
          void send(() =>
            parkering.nyVentende(orgId, {
              name: navn.trim(),
              unitLabel: enhet.trim() || null,
              requestedType: type,
              ...(siden ? { requestedAt: siden } : {}),
              notes: notater.trim() || null,
            }),
          )
        }
      />
    </Skuff>
  );
}
