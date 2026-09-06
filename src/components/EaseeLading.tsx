"use client";

import { useEffect, useMemo, useState } from "react";
import { Feil, Tom, datoTid, useOrgData } from "@/components/felles";
import { Avkryssing, Nedtrekk, Skuff, Tekstfelt, Tekstomrade } from "@/components/skjema";
import { grunnTekst, opModeTekst } from "@/lib/easee";
import { avvik as avvikApi, easee, type EaseeLader, type Ladeokt, type Plass, type Prisplan, type PrisplanInn, type Rapportlinje } from "@/lib/klient";
import { KRAFTMODELL_ETIKETT, PRISOMRADER, PRISOMRADE_ETIKETT } from "@/lib/laderegler";
import { belopFelt, kroner, tilOre } from "@/lib/okonomiregler";

/**
 * Lading-fanen i Parkering (docs/easee.md), etter Kristoffers mockup 06.09.2026: nøkkeltall
 * for anlegget, varsellinje med handling når fakturagrunnlaget er ufullstendig, laderne
 * med feil og frakoblet øverst, forbruk siste tolv måneder ved siden av «trenger
 * oppfølging», og fakturagrunnlaget per måned med øktene under hver rad.
 *
 * Uten Easee-kobling viser fanen det som er sant uansett: hvilke plasser som har
 * ladepunkt registrert. Én fjernbar pakke sammen med `innstillinger/EaseeKort.tsx`.
 */

const STROM_KORT: Record<string, string> = { forbruk: "etter forbruk", inkludert: "inkludert", fast: "fast tillegg" };
const STATUS_INFO: Record<string, { etikett: string; merke: string }> = {
  disponert: { etikett: "Disponert", merke: "muted" },
  ledig: { etikett: "Ledig", merke: "ok" },
  utleid: { etikett: "Utleid", merke: "info" },
  reservert: { etikett: "Reservert", merke: "warn" },
};
const LINJESTATUS: Record<Rapportlinje["status"], { etikett: string; farge: "g" | "w" }> = {
  klar: { etikett: "Klar", farge: "g" },
  mangler_plass: { etikett: "Uten plass", farge: "w" },
  mangler_seksjon: { etikett: "Mangler seksjon", farge: "w" },
  mangler_eier: { etikett: "Seksjon uten eier", farge: "w" },
};

/** Easees `chargerOpMode` der en bil står i laderen (2 venter, 3 lader, 4 ferdig, 6 klar, 7 venter på godkjenning, 8 avslutter). */
const BIL_TILKOBLET = new Set([2, 3, 4, 6, 7, 8]);

type Tilstand = { farge: "lader" | "tilk" | "ledig" | "off" | "feil" | "mut"; tittel: string; detalj: string | null; rang: number };

/**
 * Tilstanden i tre lag, slik styret spør: er laderen på nett, står det en bil i, lader den?
 * `rang` sorterer feil og frakoblet øverst i lista.
 */
function tilstandFor(l: EaseeLader): Tilstand {
  if (!l.active) return { farge: "mut", tittel: "Fjernet fra anlegget", detalj: null, rang: 9 };
  if (l.opMode === 5) return { farge: "feil", tittel: `Feil${l.errorCode ? ` · kode ${l.errorCode}` : ""}`, detalj: grunnTekst(l.reasonForNoCurrent) ?? "Se Easee-appen", rang: 0 };
  if (l.isOnline === false || l.opMode === 0) return { farge: "off", tittel: "Frakoblet", detalj: "Ikke kontakt med Easee", rang: 1 };
  if (l.opMode === 3) {
    return {
      farge: "lader",
      tittel: `Lader${l.totalPower ? ` · ${l.totalPower.toLocaleString("nb-NO", { maximumFractionDigits: 1 })} kW` : ""}`,
      detalj: l.sessionEnergy ? `${kwh(l.sessionEnergy)} i økten` : null,
      rang: 2,
    };
  }
  if (l.opMode !== null && BIL_TILKOBLET.has(l.opMode)) {
    const grunn = l.opMode === 4 ? "ferdig ladet" : l.opMode === 7 ? "venter på godkjenning" : l.opMode === 2 ? "venter på start" : l.opMode === 8 ? "avslutter" : grunnTekst(l.reasonForNoCurrent) ?? "klar, lader ikke";
    return { farge: "tilk", tittel: "Bil tilkoblet", detalj: grunn, rang: 3 };
  }
  if (l.opMode === 1) return { farge: "ledig", tittel: "Ledig", detalj: null, rang: 4 };
  return { farge: "mut", tittel: opModeTekst(l.opMode, l.isOnline).etikett, detalj: null, rang: 5 };
}

const kwh = (n: number | null | undefined, desimaler = 1) =>
  n === null || n === undefined ? "—" : `${n.toLocaleString("nb-NO", { minimumFractionDigits: desimaler, maximumFractionDigits: desimaler })} kWh`;
const tall = (n: number, desimaler = 1) => n.toLocaleString("nb-NO", { minimumFractionDigits: desimaler, maximumFractionDigits: desimaler });
const klokke = (iso: string) => new Date(iso).toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" });
const kortDato = (iso: string) => new Date(iso).toLocaleDateString("nb-NO", { day: "numeric", month: "short" }).replace(".", "");
const maanedNavn = (y: number, m: number) => {
  const t = new Date(y, m - 1, 1).toLocaleDateString("nb-NO", { month: "long", year: "numeric" });
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const maanedKort = (m: number) => ["jan", "feb", "mar", "apr", "mai", "jun", "jul", "aug", "sep", "okt", "nov", "des"][m - 1];
/** «12 min siden», «41 t siden», «3 dager siden» — hjelperen i felles er dagsoppløst, og laderne trenger timer. */
function sidenKort(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "nå";
  if (min < 60) return `${min} min siden`;
  if (min < 48 * 60) return `${Math.round(min / 60)} t siden`;
  return `${Math.round(min / 1440)} dager siden`;
}

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
  const [melding, setMelding] = useState<{ tekst: string; lenke?: string } | null>(null);
  const naa = new Date();
  const naaAar = naa.getFullYear();
  const naaMnd = naa.getMonth() + 1;
  const [maaned, setMaaned] = useState(() => `${naaAar}-${naaMnd}`);
  const [aar, mnd] = maaned.split("-").map(Number) as [number, number];
  const erNaa = aar === naaAar && mnd === naaMnd;
  const rapport = useOrgData((o) => easee.rapport(o, aar, mnd), [maaned]);
  // Nøkkeltallene og varsellinja gjelder alltid inneværende måned, uansett hva rapporten viser.
  const rapportNaa = useOrgData((o) => easee.rapport(o, naaAar, naaMnd));
  const planer = useOrgData((o) => easee.prisplaner(o));
  const [visPriser, setVisPriser] = useState(false);
  const [oppsett, setOppsett] = useState(false);
  const [oktSkuff, setOktSkuff] = useState<{ laderId: string; navn: string } | null>(null);
  const [apneLinjer, setApneLinjer] = useState<Set<string>>(new Set());

  const plassMedId = useMemo(() => new Map(plasser.map((p) => [p.id, p])), [plasser]);
  const ladeplasser = plasser.filter((p) => p.hasCharger);

  async function utfor(id: string, fn: () => Promise<unknown>) {
    if (!orgId) return;
    setFeil(null);
    setJobber(id);
    try {
      await fn();
      await Promise.all([last(), rapport.last(), erNaa ? Promise.resolve() : rapportNaa.last()]);
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Noe gikk galt");
    } finally {
      setJobber(null);
    }
  }

  async function opprettAvvik(l: EaseeLader) {
    if (!orgId) return;
    const t = tilstandFor(l);
    const plass = l.spotId ? plassMedId.get(l.spotId) : null;
    setFeil(null);
    setJobber(`avvik-${l.id}`);
    try {
      const a = await avvikApi.meld(orgId, {
        title: `Lader ${l.name}${plass ? ` (plass ${plass.number})` : ""}: ${t.tittel.toLowerCase()}`,
        description: [
          `Easee-lader «${l.name}», serienummer ${l.chargerId}.`,
          plass ? `Står på plass ${plass.number}${plass.areaLabel ? `, ${plass.areaLabel}` : ""}.` : "Ikke koblet til plass.",
          `Tilstand fra Easee ${l.stateCheckedAt ? datoTid(l.stateCheckedAt) : ""}: ${t.tittel}${t.detalj ? ` (${t.detalj})` : ""}.`,
          l.latestPulse ? `Sist sett av Easee ${datoTid(l.latestPulse)}.` : null,
        ].filter(Boolean).join("\n"),
      });
      setMelding({ tekst: `Avvik${a.number ? ` #${a.number}` : ""} opprettet for laderen.`, lenke: "/avvik" });
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke opprette avvik");
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
  const rn = rapportNaa.data;
  const linjePerLader = new Map((rn?.linjer ?? []).map((l) => [l.laderId, l]));
  const ladere = [...data.ladere].sort((a, b) => {
    const r = tilstandFor(a).rang - tilstandFor(b).rang;
    if (r !== 0) return r;
    return (a.plass?.number ?? "~").localeCompare(b.plass?.number ?? "~", "nb", { numeric: true });
  });
  const aktive = ladere.filter((l) => l.active);
  const online = aktive.filter((l) => l.isOnline !== false && l.opMode !== 0);
  const feilende = aktive.filter((l) => l.opMode === 5);
  const frakoblet = aktive.filter((l) => l.isOnline === false || l.opMode === 0);
  const sistSjekket = aktive.map((l) => l.stateCheckedAt).filter(Boolean).sort().at(-1) ?? null;
  const denneMaaned = data.maaneder.at(-1)?.kwh ?? 0;
  const forrigeMaaned = data.maaneder.at(-2)?.kwh ?? 0;
  const endring = forrigeMaaned > 0 ? Math.round(((denneMaaned - forrigeMaaned) / forrigeMaaned) * 100) : null;
  const ufullstendige = (rn?.linjer ?? []).filter((l) => l.status !== "klar");
  const ingenPlan = planer.data !== null && planer.data.length === 0;
  const plassValg = [...plasser].sort((a, b) => a.number.localeCompare(b.number, "nb", { numeric: true }));
  const r = rapport.data;

  // «Trenger oppfølging» — det styret må ta stilling til, avledet av det vi allerede vet.
  const oppfolging: Array<{ chip: string; farge: "c" | "w" | "n"; tittel: string; under: string; knapp?: { tekst: string; onClick: () => void } }> = [];
  for (const l of feilende) oppfolging.push({ chip: "Feil", farge: "c", tittel: `${l.name} melder feil${l.errorCode ? ` (kode ${l.errorCode})` : ""}`, under: grunnTekst(l.reasonForNoCurrent) ?? "Sjekk Easee-appen, og meld avvik om det vedvarer", knapp: kanEndre ? { tekst: "Meld avvik", onClick: () => void opprettAvvik(l) } : undefined });
  for (const l of frakoblet) oppfolging.push({ chip: "Frakoblet", farge: "n", tittel: `${l.name} har ikke kontakt med Easee`, under: l.latestPulse ? `Sist sett ${sidenKort(l.latestPulse)} — sjekk sikring og Wi-Fi før feilmelding` : "Sjekk sikring og Wi-Fi før feilmelding", knapp: kanEndre ? { tekst: "Meld avvik", onClick: () => void opprettAvvik(l) } : undefined });
  for (const l of ufullstendige) {
    if (l.kwh === 0 && l.status === "mangler_plass") continue;
    oppfolging.push({
      chip: "Faktura", farge: "w",
      tittel: l.plass ? `Plass ${l.plass.number} ${LINJESTATUS[l.status].etikett.toLowerCase()}` : `${l.laderNavn} er ikke koblet til plass`,
      under: `${tall(l.kwh)} kWh i ${maanedKort(naaMnd)} kan ikke faktureres før dette er ordnet`,
      knapp: kanEndre ? (l.plass ? { tekst: "Åpne plassen", onClick: () => { const p = plassMedId.get(l.plass!.id); if (p) onApnePlass(p); } } : { tekst: "Koble", onClick: () => setOppsett(true) }) : undefined,
    });
  }
  if (ingenPlan) oppfolging.push({ chip: "Pris", farge: "w", tittel: "Ingen prisplan er lagt inn", under: "Uten priser blir rapporten bare kWh", knapp: erAdmin ? { tekst: "Priser", onClick: () => setVisPriser(true) } : undefined });

  return (
    <>
      <Feil melding={feil ?? rapport.feil ?? planer.feil} />
      {melding && (
        <div className="ea-melding" style={{ margin: 0 }}>
          {melding.tekst} {melding.lenke && <a href={melding.lenke}>Åpne avvik</a>}
        </div>
      )}
      {data.feil && <div className="feilmelding">Easee svarte ikke — viser sist kjente tall. {data.feil}</div>}

      {/* ── Nøkkeltall ── */}
      <section className="ea-kpis print-skjul" aria-label="Nøkkeltall lading">
        <div className="ea-kpi">
          <div className="l">Ladere</div>
          <div className="v">{aktive.length} <small>hvorav {online.length} på nett</small></div>
          <div className="d">{frakoblet.length > 0 ? `${frakoblet.length} frakoblet` : sistSjekket ? `tilstand ${sidenKort(sistSjekket)}` : "tilstand ikke hentet"}</div>
        </div>
        <div className={`ea-kpi ${feilende.length > 0 ? "alert" : ""}`}>
          <div className="l">Feil</div>
          <div className="v">{feilende.length}</div>
          <div className="d">{feilende.length > 0 ? feilende.map((l) => l.name).join(", ") : "ingen ladere melder feil"}</div>
        </div>
        <div className="ea-kpi">
          <div className="l">Forbruk {maanedKort(naaMnd)}</div>
          <div className="v">{tall(denneMaaned, 0)} <small>kWh</small></div>
          <div className="d">
            {endring === null ? `forrige måned ${tall(forrigeMaaned, 0)} kWh` : (
              <><b className={endring >= 0 ? "opp" : "ned"}>{endring >= 0 ? "▲" : "▼"} {Math.abs(endring)} %</b> mot {maanedKort(naaMnd === 1 ? 12 : naaMnd - 1)} ({tall(forrigeMaaned, 0)} kWh)</>
            )}
          </div>
        </div>
        <div className="ea-kpi">
          <div className="l">Fakturerbart hittil</div>
          <div className="v">{rn?.plan ? kroner(rn.klar.sumOre).replace(" kr", "") : "—"} <small>kr</small></div>
          <div className="d">{rn?.plan ? `${rn.klar.antall} seksjon${rn.klar.antall === 1 ? "" : "er"} · ${kroner(rn.sum.fastleddOre)} fastledd` : "sett priser for å få kroner"}</div>
        </div>
        <div className="ea-kpi">
          <div className="l">Fakturagrunnlag</div>
          <div className="v"><span className={ufullstendige.length > 0 ? "gul" : ""}>{rn?.klar.antall ?? 0}</span> <small>av {rn?.linjer.length ?? 0} klare</small></div>
          <div className="d">{ufullstendige.length > 0 ? ufullstendige.map((l) => (l.plass ? `${l.plass.number} ${LINJESTATUS[l.status].etikett.toLowerCase()}` : `${l.laderNavn} uten plass`)).join(" · ") : "alle linjer har mottaker"}</div>
        </div>
      </section>

      {/* ── Varsellinje ── */}
      {ufullstendige.length > 0 && (
        <div className="ea-banner print-skjul" role="status">
          <div className="ic">!</div>
          <p>
            <b>Fakturagrunnlaget for {maanedNavn(naaAar, naaMnd).toLowerCase()} er ufullstendig.</b>{" "}
            {ufullstendige.map((l) => (l.plass ? `Plass ${l.plass.number} ${LINJESTATUS[l.status].etikett.toLowerCase()}` : `${l.laderNavn} er ikke koblet til plass`)).join(", ")}.
            {" "}Forbruket der ({tall(ufullstendige.reduce((n, l) => n + l.kwh, 0))} kWh) kan ikke faktureres før dette er ordnet.
          </p>
          {kanEndre && ufullstendige.some((l) => !l.plass) && <button className="btn btn-ghost" onClick={() => setOppsett(true)}>Koble til plasser</button>}
          {kanEndre && ufullstendige.filter((l) => l.plass).slice(0, 2).map((l) => (
            <button key={l.laderId} className="btn btn-ghost" onClick={() => { const p = plassMedId.get(l.plass!.id); if (p) onApnePlass(p); }}>Åpne {l.plass!.number}</button>
          ))}
        </div>
      )}

      {/* ── Anlegget ── */}
      <section className="card print-skjul" style={{ overflow: "hidden" }}>
        <div className="card-header">
          <div>
            <div className="card-title">Anlegg · {data.anlegg?.siteName}</div>
            <div className="field-note">
              {aktive.length} lader{aktive.length === 1 ? "" : "e"}
              <span className="ea-sync"><i className={data.feil ? "rod" : ""} />Easee · {sistSjekket ? `synkronisert ${klokke(sistSjekket)}` : "ikke synkronisert"}</span>
            </div>
          </div>
          {kanEndre && (
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              <button className="btn btn-ghost" disabled={jobber !== null} onClick={() => void utfor("alt", () => easee.oppdater(orgId!))}>
                {jobber === "alt" ? "Henter …" : "Oppdater fra Easee"}
              </button>
              <button className={`btn ${oppsett ? "btn-primary" : "btn-ghost"}`} onClick={() => setOppsett((v) => !v)}>
                {oppsett ? "Ferdig" : "Koble til plasser"}
                {!oppsett && aktive.some((l) => !l.spotId) && <span className="ea-n">{aktive.filter((l) => !l.spotId).length} ukoblet</span>}
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
          <table className="ea-tabell">
            <thead>
              <tr>
                <th>Lader</th><th>Plass</th><th>Seksjon / disponent</th><th>Tilstand</th><th>Sist online</th><th>Siste ladeøkt</th><th className="r">Denne måneden</th><th />
              </tr>
            </thead>
            <tbody>
              {ladere.length === 0 ? (
                <tr><td colSpan={8}><Tom tekst="Easee rapporterer ingen ladere i anlegget. Sjekk at kontoen er site owner for riktig anlegg." /></td></tr>
              ) : (
                ladere.map((l) => {
                  const t = tilstandFor(l);
                  const plass = l.spotId ? plassMedId.get(l.spotId) ?? null : null;
                  const linje = linjePerLader.get(l.id);
                  const o = l.sisteOkt;
                  return (
                    <tr key={l.id} className="ea-rad" style={l.active ? undefined : { opacity: 0.55 }} onClick={() => setOktSkuff({ laderId: l.id, navn: plass ? `Plass ${plass.number}` : l.name })}>
                      <td className="ea-lader-navn"><b>{l.name}</b><span>{l.chargerId}</span></td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {kanEndre && oppsett && l.active ? (
                          <select className="input" value={l.spotId ?? ""} disabled={jobber === l.id} onChange={(e) => void utfor(l.id, () => easee.kobleTilPlass(orgId!, l.id, e.target.value || null))} aria-label={`Plass for ${l.name}`}>
                            <option value="">Ikke koblet</option>
                            {plassValg.map((p) => <option key={p.id} value={p.id}>{p.number}{p.areaLabel ? `, ${p.areaLabel}` : ""}</option>)}
                          </select>
                        ) : plass ? (
                          <button className="ea-plass" onClick={() => onApnePlass(plass)}>{plass.number}</button>
                        ) : (
                          <span className="ea-chip w" onClick={() => kanEndre && setOppsett(true)}>＋ Ikke koblet</span>
                        )}
                      </td>
                      <td>
                        {linje && linje.status !== "klar" && linje.status !== "mangler_plass" ? (
                          <span className="ea-chip w" onClick={(e) => { e.stopPropagation(); if (plass) onApnePlass(plass); }}>＋ {LINJESTATUS[linje.status].etikett}</span>
                        ) : l.plass ? (
                          <>
                            {l.plass.unitLabel ?? <span className="mut">—</span>}
                            <span className="ea-under">{l.avtale ? `${l.avtale.tenantName}${l.avtale.powerBilling ? ` · strøm ${STROM_KORT[l.avtale.powerBilling] ?? l.avtale.powerBilling}` : ""}` : linje?.eier?.name ?? l.plass.holderName ?? ""}</span>
                          </>
                        ) : (
                          <span className="mut">—</span>
                        )}
                      </td>
                      <td>
                        <span className={`ea-st ${t.farge}`}><i />{t.tittel}</span>
                        {t.detalj && <span className="ea-under">{t.detalj}</span>}
                      </td>
                      <td>
                        {l.isOnline !== false && l.opMode !== 0 && l.active ? "Nå" : l.latestPulse ? <>{kortDato(l.latestPulse)} {klokke(l.latestPulse)}<span className="ea-under">{sidenKort(l.latestPulse)}</span></> : <span className="mut">—</span>}
                      </td>
                      <td>
                        {l.opMode === 3 ? (
                          <>Pågår<span className="ea-under">{l.sessionEnergy ? kwh(l.sessionEnergy) : ""}</span></>
                        ) : o ? (
                          <>{kortDato(o.carConnected)}<span className="ea-under">{klokke(o.carConnected)}{o.carDisconnected ? ` – ${klokke(o.carDisconnected)}` : ""} · {kwh(o.kwh)}</span></>
                        ) : (
                          <span className="mut">—</span>
                        )}
                      </td>
                      <td className="r ea-mono">{kwh(linje?.kwh ?? data.forbruk.find((f) => f.chargerRowId === l.id && f.year === naaAar && f.month === naaMnd)?.kwh ?? 0)}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="ea-radakt">
                          {kanEndre && l.active && <button className="ea-ico" title="Meld avvik på laderen" disabled={jobber === `avvik-${l.id}`} onClick={() => void opprettAvvik(l)}>⚠</button>}
                          <button className="ea-ico" title="Ladeøktene" onClick={() => setOktSkuff({ laderId: l.id, navn: plass ? `Plass ${plass.number}` : l.name })}>›</button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="ea-fot">Feil og frakoblet sorteres alltid øverst. ⚠ oppretter et avvik med laderens navn, serienummer og tilstand ferdig utfylt.</div>
      </section>

      {/* ── Forbruk og oppfølging ── */}
      <div className="ea-to print-skjul">
        <section className="card" style={{ overflow: "hidden" }}>
          <div className="card-header">
            <div>
              <div className="card-title">Forbruk siste 12 måneder</div>
              <div className="field-note">kWh per måned{data.maaneder.some((m) => m.kwhNatt !== null) ? ", dag og natt der timesdata finnes" : ""}</div>
            </div>
          </div>
          <Forbruksgraf maaneder={data.maaneder} />
        </section>

        <section className="card" style={{ overflow: "hidden" }}>
          <div className="card-header">
            <div>
              <div className="card-title">Trenger oppfølging</div>
              <div className="field-note">Det styret må ta stilling til</div>
            </div>
          </div>
          {oppfolging.length === 0 ? (
            <Tom tekst="Ingenting å følge opp. Alle ladere er på nett, og fakturagrunnlaget er komplett." />
          ) : (
            oppfolging.map((o, i) => (
              <div key={i} className="ea-li">
                <div style={{ minWidth: 0 }}>
                  <div className="t"><span className={`ea-chip ${o.farge}`}>{o.chip}</span> {o.tittel}</div>
                  <span className="s">{o.under}</span>
                </div>
                {o.knapp && <button className="btn btn-ghost" onClick={o.knapp.onClick}>{o.knapp.tekst}</button>}
              </div>
            ))
          )}
        </section>
      </div>

      {/* ── Fakturagrunnlag ── */}
      <section className="card ea-utskrift" style={{ overflow: "hidden" }}>
        <div className="card-header" style={{ alignItems: "flex-start" }}>
          <div>
            <div className="card-title">Fakturagrunnlag · {maanedNavn(aar, mnd).toLowerCase()}</div>
            <div className="field-note" style={{ marginBottom: "8px" }}>Per plass og seksjon, basert på Easees målinger per lader{data.anlegg?.siteName ? ` · ${data.anlegg.siteName}` : ""}</div>
            {r?.plan ? (
              <div className="ea-pris">
                <span>Kraft <b>{r.plan.kraftModel === "norgespris" ? `${kroner(r.plan.kraftOre, { alltidOre: true })}/kWh` : `spot ${r.plan.priceArea} + ${kroner(r.plan.paaslagOre, { alltidOre: true })}`}</b></span>
                <span>Nett dag <b>{kroner(r.plan.nettDagOre, { alltidOre: true })}</b></span>
                <span>Nett natt <b>{kroner(r.plan.nettNattOre, { alltidOre: true })}</b></span>
                <span>Fastledd <b>{kroner(r.plan.fastleddOre)}/mnd</b></span>
                <span>Plan <b>«{r.plan.name}»</b></span>
              </div>
            ) : (
              <div className="ea-pris"><span style={{ color: "var(--warn)" }}>Ingen prisplan gjelder — bare kWh vises</span></div>
            )}
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }} className="print-skjul">
            <select className="input" style={{ width: "auto" }} value={maaned} onChange={(e) => { setMaaned(e.target.value); setApneLinjer(new Set()); }}>
              {sisteMaaneder(naa).map(([y, m]) => <option key={`${y}-${m}`} value={`${y}-${m}`}>{maanedNavn(y, m)}</option>)}
            </select>
            <button className="btn btn-ghost" onClick={() => setVisPriser(true)}>Priser{ingenPlan && <span style={{ color: "var(--warn)" }}> · mangler</span>}</button>
            {orgId && <a className="btn btn-ghost" href={easee.rapportCsvSti(orgId, aar, mnd)}>CSV</a>}
            <button className="btn btn-ghost" onClick={() => window.print()}>Skriv ut</button>
            <button className="btn btn-primary" disabled title="Fakturering fra Lading til Økonomi kommer i neste etappe">Send til Fiken</button>
          </div>
        </div>
        {r?.advarsler.filter((a) => !/Ingen prisplan/.test(a)).map((a) => <div key={a} className="ea-advarsel">{a}</div>)}
        <div className="prk-scroll">
          <table className="ea-tabell">
            <thead>
              <tr>
                <th>Plass</th><th>Seksjon / eier</th><th>Lader</th><th className="r">Økter</th><th className="r">kWh</th><th className="r">Energi</th><th className="r">Fastledd</th><th className="r">Sum</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {!r ? (
                <tr><td colSpan={9}><Tom tekst="Henter …" /></td></tr>
              ) : r.linjer.length === 0 ? (
                <tr><td colSpan={9}><Tom tekst="Ingen ladere med forbruk eller plass denne måneden. Timesforbruket hentes av nattjobben og av «Oppdater fra Easee»." /></td></tr>
              ) : (
                <>
                  {r.linjer.map((l) => (
                    <LinjeMedOkter
                      key={l.laderId}
                      orgId={orgId!}
                      linje={l}
                      aar={aar}
                      maaned={mnd}
                      apen={apneLinjer.has(l.laderId)}
                      harPlan={Boolean(r.plan)}
                      st={LINJESTATUS[l.status]}
                      onToggle={() => setApneLinjer((s) => { const n = new Set(s); if (n.has(l.laderId)) n.delete(l.laderId); else n.add(l.laderId); return n; })}
                      onApnePlass={() => { const p = l.plass ? plassMedId.get(l.plass.id) : null; if (p) onApnePlass(p); }}
                    />
                  ))}
                  <tr className="ea-sumrad">
                    <td colSpan={3}>Sum · {r.linjer.length} plass{r.linjer.length === 1 ? "" : "er"}</td>
                    <td className="r">{r.linjer.reduce((n, l) => n + l.okter, 0)}</td>
                    <td className="r">{tall(r.sum.kwh)}</td>
                    <td className="r">{r.plan ? kroner(r.sum.kraftOre + r.sum.nettOre) : "—"}</td>
                    <td className="r">{r.plan ? kroner(r.sum.fastleddOre) : "—"}</td>
                    <td className="r">{r.plan ? kroner(r.sum.sumOre) : "—"}</td>
                    <td className="mut" style={{ fontWeight: 500 }}>{r.plan ? `${kroner(r.klar.sumOre)} klar til fakturering` : ""}</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
        <div className="ea-fot">
          Energi = kraft + nettleie (dag/natt). Klikk en rad for ladeøktene. {r?.plan ? `Natt er kl. ${r.plan.nattFra}–${r.plan.nattTil}${r.plan.helgSomNatt ? " og hele helgen" : ""}.` : ""}
          {r?.plan?.kraftModel === "spot" ? " Spotpriser fra hvakosterstrommen.no (Nord Pool), påført mva og påslag." : ""}
          {r && r.linjer.some((l) => l.timerUtenPris > 0) ? " * Timer uten spotpris er ikke priset." : ""}
          {sistSjekket ? ` Tall fra Easee, sist synkronisert ${datoTid(sistSjekket)}.` : ""}
        </div>
      </section>

      {visPriser && orgId && (
        <PriserSkuff
          orgId={orgId}
          planer={planer.data ?? []}
          erAdmin={erAdmin}
          onLukk={() => setVisPriser(false)}
          onEndret={async () => { await Promise.all([planer.last(), rapport.last(), rapportNaa.last()]); }}
        />
      )}
      {oktSkuff && orgId && (
        <OktSkuff orgId={orgId} laderId={oktSkuff.laderId} navn={oktSkuff.navn} aar={naaAar} maaned={naaMnd} onLukk={() => setOktSkuff(null)} />
      )}
    </>
  );
}

/* ── Forbruksgrafen: stolper per måned, natt nederst der vi vet den ── */

function Forbruksgraf({ maaneder }: { maaneder: Array<{ year: number; month: number; kwh: number; kwhNatt: number | null }> }) {
  const maks = Math.max(1, ...maaneder.map((m) => m.kwh));
  // Rund aksen opp til et pent tall: 10, 20, 50, 100, 200, 500 …
  const steg = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000].find((s) => s * 4 >= maks) ?? 10000;
  const topp = steg * 4;
  const W = 640, H = 220, X0 = 44, Y0 = 180, BH = 150;
  const bredde = 26, dx = (W - X0 - 20) / Math.max(1, maaneder.length);
  const y = (v: number) => Y0 - (v / topp) * BH;
  const harNatt = maaneder.some((m) => m.kwhNatt !== null);
  const s = maaneder.at(-1);
  return (
    <>
      <div style={{ padding: "12px 16px 6px" }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Stolpediagram over kWh per måned">
          <g stroke="var(--border)" strokeWidth="1">
            {[0, 1, 2, 3, 4].map((i) => <line key={i} x1={X0} y1={y(steg * i)} x2={W - 20} y2={y(steg * i)} />)}
          </g>
          <g fontFamily="var(--font-sans)" fontSize="10" fill="var(--muted)" textAnchor="end">
            {[0, 1, 2, 3, 4].map((i) => <text key={i} x={X0 - 6} y={y(steg * i) + 4}>{steg * i}</text>)}
          </g>
          {maaneder.map((m, i) => {
            const x = X0 + 10 + i * dx + (dx - bredde) / 2;
            const natt = m.kwhNatt ?? 0;
            const dag = Math.max(0, m.kwh - natt);
            const siste = i === maaneder.length - 1;
            return (
              <g key={`${m.year}-${m.month}`}>
                {m.kwhNatt !== null && natt > 0 && <rect x={x} y={y(natt)} width={bredde} height={Y0 - y(natt)} fill="#6b7cff" />}
                {dag > 0 && <rect x={x} y={y(m.kwh)} width={bredde} height={y(natt) - y(m.kwh)} fill="var(--accent)" opacity={m.kwhNatt === null ? 0.75 : 1} />}
                {m.kwh > 0 && <text x={x + bredde / 2} y={y(m.kwh) - 5} fontSize="10" fill={siste ? "var(--text)" : "var(--muted)"} textAnchor="middle" fontFamily="var(--font-sans)">{Math.round(m.kwh)}</text>}
                <text x={x + bredde / 2} y={Y0 + 16} fontSize="10" fill={siste ? "var(--text)" : "var(--muted)"} fontWeight={siste ? 700 : 400} textAnchor="middle" fontFamily="var(--font-sans)">{maanedKort(m.month)}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="ea-legend">
        <span><i style={{ background: "var(--accent)" }} />Dag{harNatt ? "" : " (totalt der timesdata mangler)"}</span>
        {harNatt && <span><i style={{ background: "#6b7cff" }} />Natt</span>}
        {s && s.kwhNatt !== null && s.kwh > 0 && <span className="mut">Nattandel {maanedKort(s.month)}: {Math.round((s.kwhNatt / s.kwh) * 100)} %</span>}
      </div>
    </>
  );
}

/* ── Én linje i fakturagrunnlaget, med øktene under når den er åpen ── */

function LinjeMedOkter({ orgId, linje: l, aar, maaned, apen, harPlan, st, onToggle, onApnePlass }: {
  orgId: string; linje: Rapportlinje; aar: number; maaned: number; apen: boolean; harPlan: boolean;
  st: { etikett: string; farge: "g" | "w" }; onToggle: () => void; onApnePlass: () => void;
}) {
  const [okter, setOkter] = useState<Ladeokt[] | null>(null);
  useEffect(() => {
    if (!apen || okter) return;
    let aktiv = true;
    easee.okter(orgId, l.laderId, aar, maaned).then((o) => aktiv && setOkter(o)).catch(() => aktiv && setOkter([]));
    return () => { aktiv = false; };
  }, [apen, okter, orgId, l.laderId, aar, maaned]);
  const mottaker = l.eier?.name ?? l.avtale?.tenantName ?? l.plass?.holderName ?? null;
  return (
    <>
      <tr className="ea-rad" onClick={onToggle} aria-expanded={apen}>
        <td>{l.plass ? <span className="ea-plasschip">{l.plass.number}</span> : <span className="mut">—</span>}</td>
        <td>
          {l.status === "mangler_seksjon" || l.status === "mangler_eier" ? (
            <span className="ea-chip w" onClick={(e) => { e.stopPropagation(); onApnePlass(); }}>＋ {st.etikett}</span>
          ) : l.status === "mangler_plass" ? (
            <span className="mut">Ikke koblet til plass</span>
          ) : (
            <>{l.seksjon?.navn}{mottaker && <span className="ea-under">{mottaker}</span>}</>
          )}
        </td>
        <td className="mut">{l.laderNavn}{l.aktiv ? "" : " (fjernet)"}</td>
        <td className="r">{l.okter}</td>
        <td className="r">{tall(l.kwh)}</td>
        <td className="r">{harPlan ? `${kroner(l.kraftOre + l.nettOre)}${l.timerUtenPris > 0 ? " *" : ""}` : "—"}</td>
        <td className="r">{harPlan ? kroner(l.fastleddOre) : "—"}</td>
        <td className="r"><b>{harPlan ? kroner(l.sumOre) : "—"}</b></td>
        <td><span className={`ea-chip ${st.farge}`}>{st.etikett}</span></td>
      </tr>
      {apen && (
        <tr className="ea-underrad">
          <td colSpan={9}>
            {!okter ? (
              <div className="ea-okter-rad"><span className="mut">Henter økter …</span></div>
            ) : okter.length === 0 ? (
              <div className="ea-okter-rad"><span className="mut">Ingen ladeøkter registrert denne måneden.</span></div>
            ) : (
              <div className="ea-okter-rad">
                {okter.map((o) => (
                  <div key={o.id} className="ea-okt-kort">
                    <b>{kortDato(o.carConnected)} {klokke(o.carConnected)}{o.carDisconnected ? ` – ${klokke(o.carDisconnected)}` : " – pågår"}</b>
                    <span>{kwh(o.kwh, 2)}</span>
                  </div>
                ))}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

/* ── Prisene: liste og skjema i samme skuff ── */

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

/* ── Ladeøktene for én lader (skuff fra laderlista) ── */

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
