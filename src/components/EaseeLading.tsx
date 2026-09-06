"use client";

import { useMemo, useState } from "react";
import { Feil, Tom, datoTid, useOrgData } from "@/components/felles";
import { opModeTekst } from "@/lib/easee";
import { easee, type EaseeLader, type Plass } from "@/lib/klient";
import { kroner } from "@/lib/okonomiregler";

/**
 * Lading-fanen i Parkering (docs/easee.md). Uten Easee-kobling viser den det som er sant
 * uansett: hvilke plasser som har ladepunkt registrert. Med kobling kommer laderne fra
 * anlegget med tilstand, plasskobling og månedsforbruk — og en avregning per måned.
 * Én fjernbar pakke sammen med `innstillinger/EaseeKort.tsx`.
 */

const STROM_KORT: Record<string, string> = { forbruk: "etter forbruk", inkludert: "inkludert", fast: "fast tillegg" };
const STATUS_INFO: Record<string, { etikett: string; merke: string }> = {
  disponert: { etikett: "Disponert", merke: "muted" },
  ledig: { etikett: "Ledig", merke: "ok" },
  utleid: { etikett: "Utleid", merke: "info" },
  reservert: { etikett: "Reservert", merke: "warn" },
};

const kwh = (n: number | null | undefined, desimaler = 1) =>
  n === null || n === undefined ? "—" : `${n.toLocaleString("nb-NO", { minimumFractionDigits: desimaler, maximumFractionDigits: desimaler })} kWh`;

const maanedNavn = (y: number, m: number) => {
  const t = new Date(y, m - 1, 1).toLocaleDateString("nb-NO", { month: "long", year: "numeric" });
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export default function EaseeLading({
  plasser,
  kanEndre,
  onApnePlass,
}: {
  plasser: Plass[];
  kanEndre: boolean;
  onApnePlass: (p: Plass) => void;
}) {
  const { data, feil, setFeil, laster, last, orgId } = useOrgData((o) => easee.lading(o));
  const [jobber, setJobber] = useState<string | null>(null);
  const naa = new Date();
  const [maaned, setMaaned] = useState(() => `${naa.getFullYear()}-${naa.getMonth() + 1}`);

  const plassMedId = useMemo(() => new Map(plasser.map((p) => [p.id, p])), [plasser]);
  // Månedene det finnes forbruk for — pluss inneværende, så avregningen alltid har et valg.
  const maaneder = useMaaneder(data?.forbruk ?? [], naa);
  const ladeplasser = plasser.filter((p) => p.hasCharger);

  async function utfor(id: string, fn: () => Promise<unknown>) {
    if (!orgId) return;
    setFeil(null);
    setJobber(id);
    try {
      await fn();
      await last();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Noe gikk galt");
    } finally {
      setJobber(null);
    }
  }

  if (laster && !data) return <Tom tekst="Henter …" />;

  /* ── Uten kobling: bare det som er registrert på plassene ── */
  if (!data?.koblet) {
    return (
      <>
        <Feil melding={feil} />
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
                      <span style={{ color: "var(--warn)", fontSize: "var(--fs-label)" }}>⚡ {p.chargerLabel || "Ladepunkt"}</span>
                      <span style={{ minWidth: 0 }}>
                        {[p.unitLabel, p.holderName].filter(Boolean).join(", ") || <span style={{ color: "var(--muted)" }}>Ingen</span>}
                      </span>
                      <span><span className={`badge ${st.merke}`}>{st.etikett}</span></span>
                      <span style={{ display: "flex", justifyContent: "flex-end" }}>
                        <button className="btn btn-ghost" onClick={() => onApnePlass(p)}>Åpne</button>
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
        <div className="prk-note">
          Har dere <b>Easee</b>-ladere? Koble anlegget til under Innstillinger → Integrasjoner, så
          vises laderne her med tilstand, plass og strømforbruk per måned — klart til avregning.
          Andre anlegg (Zaptec m.fl.) er ikke støttet ennå; si fra hva dere har.
        </div>
      </>
    );
  }

  /* ── Med kobling ── */
  const ladere = data.ladere;
  const aktive = ladere.filter((l) => l.active);
  const sistSjekket = aktive.map((l) => l.stateCheckedAt).filter(Boolean).sort().at(-1) ?? null;
  const lader = aktive.filter((l) => l.isOnline !== false && l.opMode === 3);
  const effekt = lader.reduce((n, l) => n + (l.totalPower ?? 0), 0);
  const frakoblet = aktive.filter((l) => l.isOnline === false || l.opMode === 0 || l.opMode === 5);

  const [aar, mnd] = maaned.split("-").map(Number) as [number, number];
  const forbrukNaa = new Map(data.forbruk.filter((f) => f.year === aar && f.month === mnd).map((f) => [f.chargerRowId, f.kwh]));
  const denneMaaned = new Map(
    data.forbruk.filter((f) => f.year === naa.getFullYear() && f.month === naa.getMonth() + 1).map((f) => [f.chargerRowId, f.kwh]),
  );
  const pris = data.anlegg?.pricePerKwhOre ?? null;
  const avregning = ladere
    .filter((l) => forbrukNaa.has(l.id))
    .map((l) => ({ l, kwh: forbrukNaa.get(l.id) ?? 0 }))
    .sort((a, b) => (a.l.plass?.number ?? "~").localeCompare(b.l.plass?.number ?? "~", "nb", { numeric: true }));
  const sumKwh = avregning.reduce((n, r) => n + r.kwh, 0);

  const plassValg = [...plasser].sort((a, b) => a.number.localeCompare(b.number, "nb", { numeric: true }));

  return (
    <>
      <Feil melding={feil} />
      {data.feil && <div className="feilmelding">Easee svarte ikke — viser sist kjente tall. {data.feil}</div>}

      <div className="prk-stripe">
        <div className="prk-stripe-del">
          <div className="k">Anlegg</div>
          <div className="v" style={{ fontSize: "var(--fs-md)" }}>{data.anlegg?.siteName}</div>
        </div>
        <div className="prk-stripe-del">
          <div className="k">Ladere</div>
          <div className="v">{aktive.length} <small>{aktive.filter((l) => l.spotId).length} koblet til plass</small></div>
        </div>
        <div className="prk-stripe-del">
          <div className="k">Lader nå</div>
          <div className="v gronn">{lader.length} <small>{effekt > 0 ? `${effekt.toLocaleString("nb-NO", { maximumFractionDigits: 1 })} kW` : ""}</small></div>
        </div>
        <div className="prk-stripe-del">
          <div className="k">Frakoblet / feil</div>
          <div className={`v ${frakoblet.length > 0 ? "gul" : ""}`}>{frakoblet.length}</div>
        </div>
      </div>

      <div className="card" style={{ overflow: "hidden" }}>
        <div className="card-header">
          <div>
            <div className="card-title">Ladere i anlegget</div>
            <div className="field-note">
              {sistSjekket ? `Tilstand fra Easee ${datoTid(sistSjekket)}` : "Tilstand ikke hentet ennå"} · friskes opp når fanen åpnes
            </div>
          </div>
          {kanEndre && (
            <button className="btn btn-ghost" disabled={jobber !== null} onClick={() => void utfor("alt", () => easee.oppdater(orgId!))}>
              {jobber === "alt" ? "Henter …" : "Oppdater fra Easee"}
            </button>
          )}
        </div>
        <div className="prk-scroll">
          <div className="prk-min">
            <div className="prk-hode ea-lader">
              <span>Lader</span><span>Plass</span><span>Disponent</span><span>Tilstand</span><span>Denne måneden</span>
            </div>
            {ladere.length === 0 ? (
              <Tom tekst="Easee rapporterer ingen ladere i anlegget. Sjekk at nøkkelen er laget for riktig anlegg." />
            ) : (
              ladere.map((l) => (
                <LaderRad
                  key={l.id}
                  lader={l}
                  plass={l.spotId ? plassMedId.get(l.spotId) ?? null : null}
                  plassValg={plassValg}
                  kanEndre={kanEndre}
                  jobber={jobber === l.id}
                  kwhDenneMaaned={denneMaaned.get(l.id)}
                  onKoble={(spotId) => void utfor(l.id, () => easee.kobleTilPlass(orgId!, l.id, spotId))}
                  onApnePlass={onApnePlass}
                />
              ))
            )}
          </div>
        </div>
      </div>

      <div className="card" style={{ overflow: "hidden" }}>
        <div className="card-header">
          <div>
            <div className="card-title">Avregning</div>
            <div className="field-note">
              Strømforbruk per lader og plass, slik Easee har målt det.
              {pris === null ? " Sett strømpris under Innstillinger → Integrasjoner for å få kroner." : ` Pris ${kroner(pris, { alltidOre: true })}/kWh.`}
            </div>
          </div>
          <select className="input" style={{ width: "auto" }} value={maaned} onChange={(e) => setMaaned(e.target.value)}>
            {maaneder.map(([y, m]) => (
              <option key={`${y}-${m}`} value={`${y}-${m}`}>{maanedNavn(y, m)}</option>
            ))}
          </select>
        </div>
        <div className="prk-scroll">
          <div className="prk-min">
            <div className={`prk-hode ${pris === null ? "ea-avregning-uten" : "ea-avregning"}`}>
              <span>Plass</span><span>Disponent</span><span>Lader</span><span style={{ textAlign: "right" }}>kWh</span>
              {pris !== null && <span style={{ textAlign: "right" }}>Beløp</span>}
            </div>
            {avregning.length === 0 ? (
              <Tom tekst="Ingen forbruk registrert for denne måneden ennå." />
            ) : (
              <>
                {avregning.map(({ l, kwh: k }) => (
                  <div key={l.id} className={`prk-rad ${pris === null ? "ea-avregning-uten" : "ea-avregning"}`}>
                    <span className="prk-nr" style={{ width: "60px" }}>{l.plass?.number ?? <span style={{ color: "var(--muted)", fontWeight: 400 }}>—</span>}</span>
                    <span style={{ minWidth: 0 }}>
                      <Disponent lader={l} />
                    </span>
                    <span style={{ minWidth: 0, fontSize: "var(--fs-label)", color: "var(--muted)" }}>{l.name}{l.active ? "" : " (fjernet)"}</span>
                    <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{k.toLocaleString("nb-NO", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span>
                    {pris !== null && <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{kroner(Math.round(k * pris))}</span>}
                  </div>
                ))}
                <div className={`prk-rad ${pris === null ? "ea-avregning-uten" : "ea-avregning"} ea-sum`}>
                  <span>Sum</span><span /><span />
                  <span style={{ textAlign: "right" }}>{sumKwh.toLocaleString("nb-NO", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span>
                  {pris !== null && <span style={{ textAlign: "right" }}>{kroner(Math.round(sumKwh * pris))}</span>}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="prk-note">
        Tallene er Easees egne målinger per lader og måned. Inneværende måned oppdateres
        underveis; tidligere måneder ligger fast. Leieavtaler med strøm <b>etter forbruk</b>
        er dem som skal faktureres — de andre står her til opplysning.
      </div>
    </>
  );
}

/** Månedene som finnes i forbruket, nyeste først, alltid med inneværende måned. */
function useMaaneder(forbruk: Array<{ year: number; month: number }>, naa: Date): Array<[number, number]> {
  return useMemo(() => {
    const sett = new Set<string>([`${naa.getFullYear()}-${naa.getMonth() + 1}`]);
    for (const f of forbruk) sett.add(`${f.year}-${f.month}`);
    return [...sett]
      .map((s) => s.split("-").map(Number) as [number, number])
      .sort((a, b) => b[0] - a[0] || b[1] - a[1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forbruk]);
}

function Disponent({ lader }: { lader: EaseeLader }) {
  if (!lader.plass) return <span style={{ color: "var(--muted)" }}>Ikke koblet til plass</span>;
  const disponent = [lader.plass.unitLabel, lader.plass.holderName].filter(Boolean).join(", ");
  return (
    <>
      {lader.avtale ? (
        <>
          {lader.avtale.tenantName}
          {lader.avtale.powerBilling && (
            <span className="badge muted" style={{ marginLeft: "6px" }}>strøm {STROM_KORT[lader.avtale.powerBilling] ?? lader.avtale.powerBilling}</span>
          )}
        </>
      ) : (
        disponent || <span style={{ color: "var(--muted)" }}>Ingen</span>
      )}
    </>
  );
}

function LaderRad({
  lader,
  plass,
  plassValg,
  kanEndre,
  jobber,
  kwhDenneMaaned,
  onKoble,
  onApnePlass,
}: {
  lader: EaseeLader;
  plass: Plass | null;
  plassValg: Plass[];
  kanEndre: boolean;
  jobber: boolean;
  kwhDenneMaaned: number | undefined;
  onKoble: (spotId: string | null) => void;
  onApnePlass: (p: Plass) => void;
}) {
  const t = lader.active ? opModeTekst(lader.opMode, lader.isOnline) : { etikett: "Fjernet fra anlegget", merke: "muted" as const };
  return (
    <div className="prk-rad ea-lader" style={lader.active ? undefined : { opacity: 0.6 }}>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontWeight: 600 }}>⚡ {lader.name}</span>
        <span className="list-meta">{lader.chargerId}{lader.circuitName ? ` · ${lader.circuitName}` : ""}</span>
      </span>
      <span style={{ minWidth: 0 }}>
        {kanEndre && lader.active ? (
          <select
            className="input"
            value={lader.spotId ?? ""}
            disabled={jobber}
            onChange={(e) => onKoble(e.target.value || null)}
            aria-label={`Plass for ${lader.name}`}
          >
            <option value="">Ikke koblet</option>
            {plassValg.map((p) => (
              <option key={p.id} value={p.id}>
                {p.number}{p.areaLabel ? `, ${p.areaLabel}` : ""}
              </option>
            ))}
          </select>
        ) : plass ? (
          <button className="btn btn-ghost" style={{ padding: "2px 8px" }} onClick={() => onApnePlass(plass)}>
            {plass.number}
          </button>
        ) : (
          <span style={{ color: "var(--muted)" }}>—</span>
        )}
      </span>
      <span style={{ minWidth: 0 }}><Disponent lader={lader} /></span>
      <span>
        <span className={`badge ${t.merke}`}>{t.etikett}</span>
        {lader.active && lader.opMode === 3 && lader.totalPower ? (
          <span className="list-meta">{lader.totalPower.toLocaleString("nb-NO", { maximumFractionDigits: 1 })} kW · {kwh(lader.sessionEnergy)} i økten</span>
        ) : null}
      </span>
      <span style={{ fontVariantNumeric: "tabular-nums" }}>{kwh(kwhDenneMaaned)}</span>
    </div>
  );
}
