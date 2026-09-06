"use client";

import { useEffect, useMemo, useState } from "react";
import { Feil, Tom, datoTid, useOrgData } from "@/components/felles";
import { Avkryssing, Nedtrekk, Skuff, Tekstfelt, Tekstomrade } from "@/components/skjema";
import { opModeTekst } from "@/lib/easee";
import { easee, type EaseeLader, type Ladeokt, type Plass, type Prisplan, type PrisplanInn } from "@/lib/klient";
import { KRAFTMODELL_ETIKETT, PRISOMRADER, PRISOMRADE_ETIKETT } from "@/lib/laderegler";
import { belopFelt, kroner, tilOre } from "@/lib/okonomiregler";

/**
 * Lading-fanen i Parkering (docs/easee.md). Uten Easee-kobling viser den det som er sant
 * uansett: hvilke plasser som har ladepunkt registrert. Med kobling kommer laderne fra
 * anlegget med tilstand og plasskobling, månedsrapporten per plass og seksjon priset
 * etter prisplanen, og prisplanene selv. Én fjernbar pakke sammen med
 * `innstillinger/EaseeKort.tsx`.
 */

const STROM_KORT: Record<string, string> = { forbruk: "etter forbruk", inkludert: "inkludert", fast: "fast tillegg" };
const STATUS_INFO: Record<string, { etikett: string; merke: string }> = {
  disponert: { etikett: "Disponert", merke: "muted" },
  ledig: { etikett: "Ledig", merke: "ok" },
  utleid: { etikett: "Utleid", merke: "info" },
  reservert: { etikett: "Reservert", merke: "warn" },
};

/** Easees `chargerOpMode` der en bil står i laderen (2 venter, 3 lader, 4 ferdig, 6 klar, 7 venter på godkjenning, 8 avslutter). */
const BIL_TILKOBLET = new Set([2, 3, 4, 6, 7, 8]);

/**
 * Tilstanden i tre lag, slik styret spør: er laderen på nett, står det en bil i, lader den?
 * Én linje med farge og én forklaring under — i stedet for Easees ni tilstander rett av.
 */
function tilstandFor(l: EaseeLader): { farge: "ok" | "info" | "muted" | "danger" | "warn"; tittel: string; detalj: string | null } {
  if (!l.active) return { farge: "muted", tittel: "Fjernet fra anlegget", detalj: null };
  if (l.isOnline === false || l.opMode === 0) return { farge: "danger", tittel: "Frakoblet", detalj: "Laderen har ikke kontakt med Easee" };
  if (l.opMode === 5) return { farge: "danger", tittel: "Feil på laderen", detalj: "Se Easee-appen" };
  if (l.opMode === 3) {
    return {
      farge: "ok",
      tittel: `Lader${l.totalPower ? ` · ${l.totalPower.toLocaleString("nb-NO", { maximumFractionDigits: 1 })} kW` : ""}`,
      detalj: l.sessionEnergy ? `${kwh(l.sessionEnergy)} i økten` : null,
    };
  }
  if (l.opMode !== null && BIL_TILKOBLET.has(l.opMode)) {
    const grunn = l.opMode === 4 ? "ferdig ladet" : l.opMode === 7 ? "venter på godkjenning" : l.opMode === 2 ? "venter på start" : l.opMode === 8 ? "avslutter" : "klar, lader ikke";
    return { farge: "info", tittel: "Bil tilkoblet", detalj: `${grunn}${l.sessionEnergy ? ` · ${kwh(l.sessionEnergy)} i økten` : ""}` };
  }
  if (l.opMode === 1) return { farge: "muted", tittel: "Ingen bil", detalj: null };
  return { farge: "muted", tittel: opModeTekst(l.opMode, l.isOnline).etikett, detalj: null };
}

const kwh = (n: number | null | undefined, desimaler = 1) =>
  n === null || n === undefined ? "—" : `${n.toLocaleString("nb-NO", { minimumFractionDigits: desimaler, maximumFractionDigits: desimaler })} kWh`;
const tall = (n: number, desimaler = 1) => n.toLocaleString("nb-NO", { minimumFractionDigits: desimaler, maximumFractionDigits: desimaler });

const maanedNavn = (y: number, m: number) => {
  const t = new Date(y, m - 1, 1).toLocaleDateString("nb-NO", { month: "long", year: "numeric" });
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** De siste 13 månedene, nyeste først. */
function sisteMaaneder(naa: Date): Array<[number, number]> {
  const ut: Array<[number, number]> = [];
  for (let i = 0; i < 13; i++) {
    const d = new Date(naa.getFullYear(), naa.getMonth() - i, 1);
    ut.push([d.getFullYear(), d.getMonth() + 1]);
  }
  return ut;
}

export default function EaseeLading({
  plasser,
  kanEndre,
  erAdmin,
  onApnePlass,
}: {
  plasser: Plass[];
  kanEndre: boolean;
  erAdmin: boolean;
  onApnePlass: (p: Plass) => void;
}) {
  const { data, feil, setFeil, laster, last, orgId } = useOrgData((o) => easee.lading(o));
  const [jobber, setJobber] = useState<string | null>(null);
  const naa = new Date();
  const [maaned, setMaaned] = useState(() => `${naa.getFullYear()}-${naa.getMonth() + 1}`);
  const [aar, mnd] = maaned.split("-").map(Number) as [number, number];
  const rapport = useOrgData((o) => easee.rapport(o, aar, mnd), [maaned]);
  const planer = useOrgData((o) => easee.prisplaner(o));
  const [visPriser, setVisPriser] = useState(false);
  const [oppsett, setOppsett] = useState(false);
  const [oktSkuff, setOktSkuff] = useState<{ laderId: string; navn: string } | null>(null);

  const plassMedId = useMemo(() => new Map(plasser.map((p) => [p.id, p])), [plasser]);
  const ladeplasser = plasser.filter((p) => p.hasCharger);

  async function utfor(id: string, fn: () => Promise<unknown>) {
    if (!orgId) return;
    setFeil(null);
    setJobber(id);
    try {
      await fn();
      await Promise.all([last(), rapport.last()]);
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
          vises laderne her med tilstand, plass og strømforbruk per måned — priset etter deres
          strømavtale og klart til fakturering. Andre anlegg (Zaptec m.fl.) er ikke støttet ennå.
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
  const medBil = aktive.filter((l) => l.isOnline !== false && l.opMode !== null && BIL_TILKOBLET.has(l.opMode) && l.opMode !== 3);
  const denneMaaned = new Map(
    data.forbruk.filter((f) => f.year === naa.getFullYear() && f.month === naa.getMonth() + 1).map((f) => [f.chargerRowId, f.kwh]),
  );
  const plassValg = [...plasser].sort((a, b) => a.number.localeCompare(b.number, "nb", { numeric: true }));
  const r = rapport.data;

  return (
    <>
      <Feil melding={feil ?? rapport.feil ?? planer.feil} />
      {data.feil && <div className="feilmelding">Easee svarte ikke — viser sist kjente tall. {data.feil}</div>}

      {/* ── Laderne ── */}
      <div className="card print-skjul" style={{ overflow: "hidden" }}>
        <div className="card-header">
          <div>
            <div className="card-title">Ladere · {data.anlegg?.siteName}</div>
            <div className="field-note">
              {aktive.length} lader{aktive.length === 1 ? "" : "e"}
              {lader.length > 0 ? ` · ${lader.length} lader nå${effekt > 0 ? ` (${effekt.toLocaleString("nb-NO", { maximumFractionDigits: 1 })} kW)` : ""}` : ""}
              {medBil.length > 0 ? ` · ${medBil.length} med bil tilkoblet` : ""}
              {frakoblet.length > 0 ? ` · ${frakoblet.length} frakoblet` : ""}
              {sistSjekket ? ` · fra Easee ${datoTid(sistSjekket)}` : " · tilstand ikke hentet ennå"}
            </div>
          </div>
          {kanEndre && (
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              <button className="btn btn-ghost" disabled={jobber !== null} onClick={() => void utfor("alt", () => easee.oppdater(orgId!))}>
                {jobber === "alt" ? "Henter …" : "Oppdater fra Easee"}
              </button>
              <button className={`btn ${oppsett ? "btn-primary" : "btn-ghost"}`} onClick={() => setOppsett((v) => !v)} title="Koble laderne til parkeringsplasser">
                {oppsett ? "Ferdig" : "Koble til plasser"}
              </button>
            </div>
          )}
        </div>
        {oppsett && (
          <div className="ea-advarsel" style={{ borderColor: "rgba(var(--accent-rgb), 0.35)", background: "rgba(var(--accent-rgb), 0.07)", color: "var(--accent)" }}>
            Velg hvilken parkeringsplass hver lader står på. Det er en engangsjobb — plassen gir disponent, seksjon og eier til rapporten.
          </div>
        )}
        <div className="prk-scroll">
          <div className="prk-min">
            <div className="prk-hode ea-lader">
              <span>Lader</span><span>Plass</span><span>Disponent</span><span>Tilstand</span><span>Denne måneden</span>
            </div>
            {ladere.length === 0 ? (
              <Tom tekst="Easee rapporterer ingen ladere i anlegget. Sjekk at kontoen er site owner for riktig anlegg." />
            ) : (
              ladere.map((l) => (
                <LaderRad
                  key={l.id}
                  lader={l}
                  plass={l.spotId ? plassMedId.get(l.spotId) ?? null : null}
                  plassValg={plassValg}
                  kanEndre={kanEndre && oppsett}
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

      {/* ── Rapporten ── */}
      <div className="card ea-utskrift" style={{ overflow: "hidden" }}>
        <div className="card-header">
          <div>
            <div className="card-title">Laderapport {maanedNavn(aar, mnd)}</div>
            <div className="field-note">
              {r?.plan
                ? `Priset etter «${r.plan.name}» (${r.plan.kraftModel === "norgespris" ? `Norgespris ${kroner(r.plan.kraftOre, { alltidOre: true })}/kWh` : `spot ${r.plan.priceArea} + ${kroner(r.plan.paaslagOre, { alltidOre: true })}/kWh`}, nett dag ${kroner(r.plan.nettDagOre, { alltidOre: true })} / natt ${kroner(r.plan.nettNattOre, { alltidOre: true })}${r.plan.fastleddOre ? `, fastledd ${kroner(r.plan.fastleddOre)}/mnd` : ""})`
                : "Ingen prisplan gjelder — bare kWh vises."}
              {data.anlegg?.siteName ? ` · ${data.anlegg.siteName}` : ""}
            </div>
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }} className="print-skjul">
            <select className="input" style={{ width: "auto" }} value={maaned} onChange={(e) => setMaaned(e.target.value)}>
              {sisteMaaneder(naa).map(([y, m]) => (
                <option key={`${y}-${m}`} value={`${y}-${m}`}>{maanedNavn(y, m)}</option>
              ))}
            </select>
            {orgId && <a className="btn btn-ghost" href={easee.rapportCsvSti(orgId, aar, mnd)}>CSV</a>}
            <button className="btn btn-ghost" onClick={() => window.print()}>Skriv ut</button>
            <button className="btn btn-ghost" onClick={() => setVisPriser(true)}>
              Priser{planer.data && planer.data.length === 0 ? " ·" : ""}{planer.data && planer.data.length === 0 && <span style={{ color: "var(--warn)" }}> mangler</span>}
            </button>
          </div>
        </div>
        {r?.advarsler.map((a) => (
          <div key={a} className="ea-advarsel">{a}</div>
        ))}
        <div className="prk-scroll">
          <div className="ea-rapport-min">
            <div className="prk-hode ea-rapport">
              <span>Plass</span><span>Seksjon / eier</span><span>Lader</span>
              <span className="h">Økter</span><span className="h">kWh dag</span><span className="h">kWh natt</span>
              <span className="h">Kraft</span><span className="h">Nett</span><span className="h">Fastledd</span><span className="h">Sum</span>
            </div>
            {!r ? (
              <Tom tekst="Henter …" />
            ) : r.linjer.length === 0 ? (
              <Tom tekst="Ingen ladere med forbruk eller plass denne måneden. Timesforbruket hentes av nattjobben og av «Oppdater fra Easee»." />
            ) : (
              <>
                {r.linjer.map((l) => (
                  <div
                    key={l.laderId}
                    className="prk-rad ea-rapport ea-klikk"
                    onClick={() => setOktSkuff({ laderId: l.laderId, navn: l.plass ? `Plass ${l.plass.number}` : l.laderNavn })}
                    title="Vis ladeøktene"
                  >
                    <span className="prk-nr" style={{ width: "60px" }}>{l.plass?.number ?? <span style={{ color: "var(--muted)", fontWeight: 400 }}>—</span>}</span>
                    <span style={{ minWidth: 0 }}>
                      {l.seksjon ? <span style={{ fontWeight: 600 }}>{l.seksjon.navn}</span> : l.plass?.unitLabel ? <span>{l.plass.unitLabel}</span> : null}
                      {l.eier ? <span className="list-meta">{l.eier.name}</span> : l.avtale ? (
                        <span className="list-meta">{l.avtale.tenantName}{l.avtale.powerBilling ? ` · strøm ${STROM_KORT[l.avtale.powerBilling] ?? l.avtale.powerBilling}` : ""}</span>
                      ) : l.plass?.holderName ? <span className="list-meta">{l.plass.holderName}</span> : !l.plass ? <span style={{ color: "var(--muted)" }}>Ikke koblet til plass</span> : (
                        <span className="list-meta" style={{ color: "var(--warn)" }}>Mangler seksjon</span>
                      )}
                    </span>
                    <span style={{ minWidth: 0, fontSize: "var(--fs-label)", color: "var(--muted)" }}>{l.laderNavn}{l.aktiv ? "" : " (fjernet)"}</span>
                    <span className="h">{l.okter}</span>
                    <span className="h">{tall(l.kwhDag)}</span>
                    <span className="h">{tall(l.kwhNatt)}</span>
                    <span className="h">{r.plan ? kroner(l.kraftOre) : "—"}{l.timerUtenPris > 0 ? " *" : ""}</span>
                    <span className="h">{r.plan ? kroner(l.nettOre) : "—"}</span>
                    <span className="h">{r.plan ? kroner(l.fastleddOre) : "—"}</span>
                    <span className="h" style={{ fontWeight: 600 }}>{r.plan ? kroner(l.sumOre) : "—"}</span>
                  </div>
                ))}
                <div className="prk-rad ea-rapport ea-sum">
                  <span>Sum</span><span /><span />
                  <span className="h">{r.linjer.reduce((n, l) => n + l.okter, 0)}</span>
                  <span className="h">{tall(r.sum.kwhDag)}</span>
                  <span className="h">{tall(r.sum.kwhNatt)}</span>
                  <span className="h">{r.plan ? kroner(r.sum.kraftOre) : "—"}</span>
                  <span className="h">{r.plan ? kroner(r.sum.nettOre) : "—"}</span>
                  <span className="h">{r.plan ? kroner(r.sum.fastleddOre) : "—"}</span>
                  <span className="h">{r.plan ? kroner(r.sum.sumOre) : "—"}</span>
                </div>
              </>
            )}
          </div>
        </div>
        <div className="field-note" style={{ padding: "10px 18px" }}>
          Timesforbruket er Easees egne målinger per lader. {r?.plan?.kraftModel === "spot" ? "Spotpriser fra hvakosterstrommen.no (Nord Pool), påført mva og påslag. " : ""}
          Natt er {r?.plan ? `kl. ${r.plan.nattFra}–${r.plan.nattTil}${r.plan.helgSomNatt ? " og hele helgen" : ""}` : "etter prisplanen"}. Klikk en rad for ladeøktene.
          {r && r.linjer.some((l) => l.timerUtenPris > 0) ? " * Timer uten spotpris er ikke priset." : ""}
        </div>
      </div>

      {visPriser && orgId && (
        <PriserSkuff
          orgId={orgId}
          planer={planer.data ?? []}
          erAdmin={erAdmin}
          onLukk={() => setVisPriser(false)}
          onEndret={async () => { await Promise.all([planer.last(), rapport.last()]); }}
        />
      )}
      {oktSkuff && orgId && (
        <OktSkuff orgId={orgId} laderId={oktSkuff.laderId} navn={oktSkuff.navn} aar={aar} maaned={mnd} onLukk={() => setOktSkuff(null)} />
      )}
    </>
  );
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
  const t = tilstandFor(lader);
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
      <span className={`ea-status ${t.farge}`}>
        <span className="ea-status-tittel"><span className="ea-punkt" />{t.tittel}</span>
        {t.detalj && <span className="list-meta">{t.detalj}</span>}
      </span>
      <span style={{ fontVariantNumeric: "tabular-nums" }}>{kwh(kwhDenneMaaned)}</span>
    </div>
  );
}

/* ── Prisplan-skjemaet ── */

const TIMER = Array.from({ length: 24 }, (_, i) => ({ verdi: String(i), etikett: `kl. ${String(i).padStart(2, "0")}` }));

/**
 * Prisene bor i en skuff: de settes sjelden (ny strømavtale, nytt år), mens laderstatus
 * og rapporten ses ofte. Lista og skjemaet ligger i samme skuff, så det ikke blir to
 * skuffer oppå hverandre.
 */
function PriserSkuff({ orgId, planer, erAdmin, onLukk, onEndret }: { orgId: string; planer: Prisplan[]; erAdmin: boolean; onLukk: () => void; onEndret: () => Promise<void> }) {
  const [rediger, setRediger] = useState<Prisplan | "ny" | null>(null);
  const [feil, setFeil] = useState<string | null>(null);
  if (rediger) {
    return (
      <PrisplanSkjema
        orgId={orgId}
        plan={rediger === "ny" ? null : rediger}
        onLukk={() => setRediger(null)}
        onLagret={async () => { setRediger(null); await onEndret(); }}
      />
    );
  }
  return (
    <Skuff
      tittel="Priser for lading"
      onLukk={onLukk}
      fot={erAdmin ? <button className="btn btn-primary" onClick={() => setRediger("ny")}>＋ Ny prisplan</button> : undefined}
    >
      <Feil melding={feil} />
      <div className="field-note" style={{ marginBottom: "12px" }}>
        Strømavtalen lading prises etter. En ny plan fra en dato erstatter den forrige fra da av — Norgespris ut året og spot fra januar er to planer. Måneden prises etter planen som gjaldt den 1.
      </div>
      {planer.length === 0 ? (
        <Tom tekst={erAdmin ? "Ingen prisplan ennå. Legg inn strømpris, nettleie og eventuelt fastledd for å få kroner i rapporten." : "Ingen prisplan er lagt inn. Kontoadmin setter priser."} />
      ) : (
        planer.map((p) => (
          <div key={p.id} className="list-item">
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="list-tittel">{p.name} <span className="badge muted" style={{ marginLeft: "6px" }}>fra {p.validFrom}</span></div>
              <div className="list-meta">
                {p.kraftModel === "norgespris" ? `Norgespris ${kroner(p.kraftOre, { alltidOre: true })}/kWh` : `Spot ${p.priceArea} + ${kroner(p.paaslagOre, { alltidOre: true })}/kWh (mva ${p.mvaProsent} %)`}
              </div>
              <div className="list-meta">
                {`Nettleie dag ${kroner(p.nettDagOre, { alltidOre: true })} / natt ${kroner(p.nettNattOre, { alltidOre: true })} (natt ${p.nattFra}–${p.nattTil}${p.helgSomNatt ? ", helg" : ""})`}
                {p.fastleddOre ? ` · fastledd ${kroner(p.fastleddOre)}/mnd per plass` : ""}
              </div>
              {p.note && <div className="list-meta">{p.note}</div>}
            </div>
            {erAdmin && (
              <span style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
                <button className="btn btn-ghost" onClick={() => setRediger(p)}>Endre</button>
                <button
                  className="btn btn-ghost"
                  style={{ color: "var(--muted)" }}
                  onClick={() => {
                    if (!window.confirm(`Slette prisplanen «${p.name}»?`)) return;
                    setFeil(null);
                    easee.slettPrisplan(orgId, p.id).then(onEndret).catch((e) => setFeil(e instanceof Error ? e.message : "Kunne ikke slette"));
                  }}
                >
                  Slett
                </button>
              </span>
            )}
          </div>
        ))
      )}
    </Skuff>
  );
}

function PrisplanSkjema({ orgId, plan, onLukk, onLagret }: { orgId: string; plan: Prisplan | null; onLukk: () => void; onLagret: () => Promise<void> }) {
  const [validFrom, setValidFrom] = useState(plan?.validFrom ?? new Date().toISOString().slice(0, 10));
  const [name, setName] = useState(plan?.name ?? "");
  const [kraftModel, setKraftModel] = useState<"norgespris" | "spot">(plan?.kraftModel ?? "norgespris");
  const [kraft, setKraft] = useState(belopFelt(plan?.kraftOre ?? 50));
  const [paaslag, setPaaslag] = useState(belopFelt(plan?.paaslagOre ?? 0));
  const [priceArea, setPriceArea] = useState<string>(plan?.priceArea ?? "NO5");
  const [mva, setMva] = useState(String(plan?.mvaProsent ?? 25));
  const [nettDag, setNettDag] = useState(belopFelt(plan?.nettDagOre ?? 0));
  const [nettNatt, setNettNatt] = useState(belopFelt(plan?.nettNattOre ?? 0));
  const [nattFra, setNattFra] = useState(String(plan?.nattFra ?? 22));
  const [nattTil, setNattTil] = useState(String(plan?.nattTil ?? 6));
  const [helg, setHelg] = useState(plan?.helgSomNatt ?? true);
  const [fastledd, setFastledd] = useState(belopFelt(plan?.fastleddOre ?? 0));
  const [note, setNote] = useState(plan?.note ?? "");
  const [feil, setFeil] = useState<string | null>(null);
  const [sender, setSender] = useState(false);

  async function lagre() {
    const ore = (tekst: string, hva: string) => {
      const v = tekst.trim() === "" ? 0 : tilOre(tekst);
      if (v === null || v < 0) throw new Error(`${hva}: skriv et beløp i kroner, f.eks. 0,45`);
      return v;
    };
    setFeil(null);
    setSender(true);
    try {
      const d: PrisplanInn = {
        validFrom,
        name: name.trim(),
        kraftModel,
        kraftOre: kraftModel === "norgespris" ? ore(kraft, "Norgespris") : 0,
        paaslagOre: kraftModel === "spot" ? ore(paaslag, "Påslag") : 0,
        priceArea: kraftModel === "spot" ? (priceArea as PrisplanInn["priceArea"]) : null,
        mvaProsent: Number(mva) || 0,
        nettDagOre: ore(nettDag, "Nettleie dag"),
        nettNattOre: ore(nettNatt, "Nettleie natt"),
        nattFra: Number(nattFra),
        nattTil: Number(nattTil),
        helgSomNatt: helg,
        fastleddOre: ore(fastledd, "Fastledd"),
        note: note.trim() || null,
      };
      await easee.lagrePrisplan(orgId, d, plan?.id);
      await onLagret();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke lagre prisplanen");
    } finally {
      setSender(false);
    }
  }

  return (
    <Skuff
      tittel={plan ? "Endre prisplan" : "Ny prisplan"}
      onLukk={onLukk}
      fot={
        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={onLukk} disabled={sender}>Tilbake</button>
          <button className="btn btn-primary" onClick={() => void lagre()} disabled={sender || !name.trim()}>{sender ? "Lagrer …" : "Lagre"}</button>
        </div>
      }
    >
      <Feil melding={feil} />
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <div className="field-row">
          <Tekstfelt etikett="Navn" verdi={name} onEndre={setName} plassholder="Norgespris 2026" />
          <Tekstfelt etikett="Gjelder fra" verdi={validFrom} onEndre={setValidFrom} type="date" notat="Måneden prises etter planen som gjaldt den 1." />
        </div>

        <div className="ea-skjema-del">Kraft</div>
        <Nedtrekk
          etikett="Strømavtale"
          verdi={kraftModel}
          onEndre={(v) => setKraftModel(v as "norgespris" | "spot")}
          valg={(["norgespris", "spot"] as const).map((k) => ({ verdi: k, etikett: KRAFTMODELL_ETIKETT[k] }))}
        />
        {kraftModel === "norgespris" ? (
          <Tekstfelt etikett="Pris per kWh (kr, inkl. mva)" verdi={kraft} onEndre={setKraft} plassholder="0,50" notat="Norgespris er 0,50 kr/kWh inkl. mva (0,40 ekskl.)." />
        ) : (
          <>
            <div className="field-row">
              <Nedtrekk etikett="Prisområde" verdi={priceArea} onEndre={setPriceArea} valg={PRISOMRADER.map((o) => ({ verdi: o, etikett: PRISOMRADE_ETIKETT[o] }))} />
              <Tekstfelt etikett="Mva på spotprisen (%)" verdi={mva} onEndre={setMva} notat="25 — 0 i Nord-Norge (NO4)." />
            </div>
            <Tekstfelt etikett="Påslag per kWh (kr, inkl. mva)" verdi={paaslag} onEndre={setPaaslag} plassholder="0,05" notat="Leverandørens påslag på spot. Spotprisen hentes time for time fra hvakosterstrommen.no." />
          </>
        )}

        <div className="ea-skjema-del">Nettleie, energiledd</div>
        <div className="field-row">
          <Tekstfelt etikett="Dag (kr/kWh)" verdi={nettDag} onEndre={setNettDag} plassholder="0,45" />
          <Tekstfelt etikett="Natt og helg (kr/kWh)" verdi={nettNatt} onEndre={setNettNatt} plassholder="0,33" />
        </div>
        <div className="field-row">
          <Nedtrekk etikett="Natt fra" verdi={nattFra} onEndre={setNattFra} valg={TIMER} />
          <Nedtrekk etikett="Natt til" verdi={nattTil} onEndre={setNattTil} valg={TIMER} />
        </div>
        <Avkryssing etikett="Hele helgen regnes som natt" verdi={helg} onEndre={setHelg} notat="Slik de fleste nettselskapene gjør det." />

        <div className="ea-skjema-del">Fastledd</div>
        <Tekstfelt etikett="Per måned per plass med lader (kr)" verdi={fastledd} onEndre={setFastledd} plassholder="0" notat="Kapasitetsledd, drift av anlegget eller avskrivning. 0 = ingen." />

        <Tekstomrade etikett="Notat" verdi={note} onEndre={setNote} rader={2} />
      </div>
    </Skuff>
  );
}

/* ── Ladeøktene for én lader ── */

function OktSkuff({ orgId, laderId, navn, aar, maaned, onLukk }: { orgId: string; laderId: string; navn: string; aar: number; maaned: number; onLukk: () => void }) {
  const [okter, setOkter] = useState<Ladeokt[] | null>(null);
  const [feil, setFeil] = useState<string | null>(null);
  useEffect(() => {
    let aktiv = true;
    easee.okter(orgId, laderId, aar, maaned).then((o) => aktiv && setOkter(o)).catch((e) => aktiv && setFeil(e instanceof Error ? e.message : "Kunne ikke hente øktene"));
    return () => { aktiv = false; };
  }, [orgId, laderId, aar, maaned]);
  const varighet = (o: Ladeokt) => {
    if (!o.carDisconnected) return "pågår";
    const min = Math.round((new Date(o.carDisconnected).getTime() - new Date(o.carConnected).getTime()) / 60000);
    return min >= 60 ? `${Math.floor(min / 60)} t ${min % 60} min` : `${min} min`;
  };
  const klokke = (iso: string) => new Date(iso).toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" });
  const dag = (iso: string) => {
    const t = new Date(iso).toLocaleDateString("nb-NO", { weekday: "long", day: "numeric", month: "long" });
    return t.charAt(0).toUpperCase() + t.slice(1);
  };
  const sammeDag = (a: string, b: string) => new Date(a).toDateString() === new Date(b).toDateString();
  return (
    <Skuff tittel={`Ladeøkter · ${navn} · ${maanedNavn(aar, maaned)}`} onLukk={onLukk}>
      <Feil melding={feil} />
      {!okter ? (
        <Tom tekst="Henter …" />
      ) : okter.length === 0 ? (
        <Tom tekst="Ingen ladeøkter denne måneden. Øktene hentes av nattjobben og «Oppdater fra Easee»." />
      ) : (
        <div className="ea-okter">
          {okter.map((o) => (
            <div key={o.id} className="ea-okt">
              <div className="ea-okt-naar">
                <div className="ea-okt-dag">{dag(o.carConnected)}</div>
                <div className="ea-okt-tid">
                  {klokke(o.carConnected)}
                  {o.carDisconnected ? ` – ${sammeDag(o.carConnected, o.carDisconnected) ? "" : `${dag(o.carDisconnected).toLowerCase()} `}${klokke(o.carDisconnected)}` : " – pågår"}
                  <span className="ea-okt-varighet">{varighet(o)}</span>
                </div>
              </div>
              <div className="ea-okt-kwh">{kwh(o.kwh, 2)}</div>
            </div>
          ))}
          <div className="ea-okt ea-okt-sum">
            <div className="ea-okt-naar"><div className="ea-okt-dag">{okter.length} økter</div></div>
            <div className="ea-okt-kwh">{kwh(okter.reduce((n, o) => n + o.kwh, 0), 2)}</div>
          </div>
        </div>
      )}
    </Skuff>
  );
}
