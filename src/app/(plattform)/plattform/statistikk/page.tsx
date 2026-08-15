"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { dagerSiden, dato, siden } from "@/components/felles";
import { Bryter } from "@/components/skjema";
import { api } from "@/lib/klient";
import { MENY, type ModulNokkel } from "@/lib/moduler";
import { kroner } from "@/lib/prisregler";
import { Ramme } from "../ramme";

/**
 * Statistikk — etter `mockups/statistikk-v3-mockup.html`: hvordan forretningen og
 * produktet faktisk står. Tall om kundenes eget arbeid (åpne avvik, oppgaver) hører
 * hjemme hos kunden og er bevisst IKKE her — se `hentStatistikk`.
 *
 * Nøkkeltallene og helsetabellen regnes i klienten fra `kunder`-radene, så demo-bryteren
 * kan slå demo-kunder av og på uten rundtur. Grafene (ukesaktivitet, modulbruk) er
 * aggregert i databasen og holder demo-kunder utenfor uansett.
 */

type Kunde = {
  id: string;
  navn: string;
  aktiv: boolean;
  demo: boolean;
  andeler: number | null;
  opprettet: string | null;
  avtaleStart: string | null;
  arssum: number | null;
  brukere: number;
  aktive30: number;
  aldriInnlogget: number;
  sistInnlogget: string | null;
  hendelser30: number;
};

type Statistikk = {
  kunder: Kunde[];
  ukesaktivitet: Array<{ uke: string; n: number }>;
  moduler: Array<{ nokkel: string; aktivert: number; brukt: number; inntekt: number }>;
  trakt: { leads: number; kontaktet: number; kvalifisert: number; kunder: number };
};

type Helse = "God" | "Svak" | "Kritisk";

const HELSE_MERKE: Record<Helse, string> = { God: "ok", Svak: "warn", Kritisk: "danger" };

/**
 * Kritisk: ingen har logget inn på over 30 dager — en kunde som ikke logger inn, sier opp
 * neste år. Svak: de logger inn, men registrerer ingenting, eller under halvparten er med.
 */
function helse(k: Kunde): Helse {
  const dagerSist = k.sistInnlogget === null ? null : (dagerSiden(k.sistInnlogget) ?? 0);
  if (dagerSist === null || dagerSist > 30) return "Kritisk";
  if (k.hendelser30 === 0 || k.aktive30 * 2 < k.brukere) return "Svak";
  return "God";
}

function modulEtikett(nokkel: string): string {
  return (MENY as Partial<Record<ModulNokkel, { etikett: string }>>)[nokkel as ModulNokkel]
    ?.etikett ?? nokkel;
}

/** Kumulativ månedsserie av `verdi` etter `dato` — sparkline-grunnlaget. */
function kumulativSerie(punkter: Array<{ dato: string | null; verdi: number }>): number[] {
  const naa = new Date();
  const mnd: Date[] = [];
  for (let i = 11; i >= 0; i--) {
    mnd.push(new Date(naa.getFullYear(), naa.getMonth() - i, 1));
  }
  return mnd.map((m) => {
    const slutt = new Date(m.getFullYear(), m.getMonth() + 1, 1);
    return punkter
      .filter((p) => p.dato !== null && new Date(p.dato) < slutt)
      .reduce((n, p) => n + p.verdi, 0);
  });
}

/** Liten trendlinje i KPI-kortet. Flat serie tegnes også flatt — det er ærligere enn å normalisere. */
function Sparkline({ serie, farge }: { serie: number[]; farge: string }) {
  const maks = Math.max(...serie, 1);
  const punkter = serie
    .map((v, i) => `${(i / (serie.length - 1)) * 240},${30 - (v / maks) * 26}`)
    .join(" ");
  return (
    <svg
      width="100%"
      height="34"
      viewBox="0 0 240 34"
      preserveAspectRatio="none"
      style={{ display: "block", marginTop: "10px" }}
      aria-hidden
    >
      <polyline points={punkter} fill="none" stroke={farge} strokeWidth="2" />
    </svg>
  );
}

export default function Statistikk() {
  const [data, setData] = useState<Statistikk | null>(null);
  const [feil, setFeil] = useState<string | null>(null);
  const [periode, setPeriode] = useState<30 | 90 | 365>(90);
  const [medDemo, setMedDemo] = useState(false);

  useEffect(() => {
    api
      .hent<Statistikk>("/plattform/statistikk")
      .then(setData)
      .catch((e) => setFeil(e instanceof Error ? e.message : "Kunne ikke hente statistikken"));
  }, []);

  const antallDemo = useMemo(
    () => (data ? data.kunder.filter((k) => k.aktiv && k.demo).length : 0),
    [data],
  );

  // Nøkkeltallene og tabellen: aktive kunder, demo etter bryteren.
  const syn = useMemo(
    () => (data ? data.kunder.filter((k) => k.aktiv && (medDemo || !k.demo)) : []),
    [data, medDemo],
  );

  const kpi = useMemo(() => {
    const inntekt = syn.reduce((n, k) => n + (k.arssum ?? 0), 0);
    const nytt90 = syn
      .filter((k) => k.avtaleStart && (dagerSiden(k.avtaleStart) ?? 999) < 90)
      .reduce((n, k) => n + (k.arssum ?? 0), 0);
    const betalende = syn.filter((k) => (k.arssum ?? 0) > 0).length;
    const andeler = syn.reduce((n, k) => n + (k.andeler ?? 0), 0);
    const brukere = syn.reduce((n, k) => n + k.brukere, 0);
    const aktive = syn.reduce((n, k) => n + k.aktive30, 0);
    const aldri = syn.reduce((n, k) => n + k.aldriInnlogget, 0);
    return { inntekt, nytt90, betalende, andeler, brukere, aktive, aldri };
  }, [syn]);

  const serier = useMemo(
    () => ({
      inntekt: kumulativSerie(syn.map((k) => ({ dato: k.avtaleStart, verdi: k.arssum ?? 0 }))),
      kunder: kumulativSerie(syn.map((k) => ({ dato: k.opprettet, verdi: 1 }))),
      andeler: kumulativSerie(syn.map((k) => ({ dato: k.opprettet, verdi: k.andeler ?? 0 }))),
    }),
    [syn],
  );

  // Bruk over tid: ukesstolper for 30/90 dager, månedsstolper for 12 måneder.
  const stolper = useMemo(() => {
    if (!data) return [];
    const fra = Date.now() - periode * 86_400_000;
    const innenfor = data.ukesaktivitet.filter((u) => new Date(u.uke).getTime() >= fra);
    if (periode < 365) {
      return innenfor.map((u) => ({ etikett: dato(u.uke), n: u.n }));
    }
    const perMnd = new Map<string, number>();
    for (const u of innenfor) {
      const nokkel = u.uke.slice(0, 7);
      perMnd.set(nokkel, (perMnd.get(nokkel) ?? 0) + u.n);
    }
    return [...perMnd.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([mnd, n]) => ({
        etikett: new Date(`${mnd}-01`).toLocaleDateString("nb-NO", { month: "short" }),
        n,
      }));
  }, [data, periode]);

  const hoyeste = stolper.reduce(
    (best, s) => (s.n > best.n ? s : best),
    { etikett: "", n: 0 },
  );

  // Helsetabellen: dårligst helse først — det er den man skal ringe.
  const tabell = useMemo(() => {
    const rang: Record<Helse, number> = { Kritisk: 0, Svak: 1, God: 2 };
    return [...syn].sort((a, b) => {
      const diff = rang[helse(a)] - rang[helse(b)];
      return diff !== 0 ? diff : a.hendelser30 - b.hendelser30;
    });
  }, [syn]);

  const moduler = data?.moduler ?? [];
  const maksAktivert = data ? data.kunder.filter((k) => k.aktiv && !k.demo).length : 0;
  // Modulen med størst gap mellom aktivert og brukt — kandidaten for en samtale.
  const verstModul = moduler
    .filter((m) => m.aktivert >= 2)
    .reduce<(typeof moduler)[number] | null>(
      (verst, m) =>
        m.aktivert - m.brukt > (verst ? verst.aktivert - verst.brukt : 0) ? m : verst,
      null,
    );

  const trakt = data?.trakt ?? { leads: 0, kontaktet: 0, kvalifisert: 0, kunder: 0 };
  const traktTrinn = [
    { lbl: "Leads", n: trakt.leads, forrige: null as number | null },
    { lbl: "Kontaktet", n: trakt.kontaktet, forrige: trakt.leads },
    { lbl: "Kvalifisert", n: trakt.kvalifisert, forrige: trakt.kontaktet },
    { lbl: "Kunde", n: trakt.kunder, forrige: trakt.kvalifisert },
  ];
  // Største frafall mellom to ledd, i antall.
  const frafall = traktTrinn
    .slice(1)
    .map((t, i) => ({ fra: traktTrinn[i]!.lbl, til: t.lbl, tap: (t.forrige ?? 0) - t.n }))
    .reduce((verst, t) => (t.tap > verst.tap ? t : verst), { fra: "", til: "", tap: 0 });

  function eksporter() {
    const felt = (v: string | number | null) => `"${String(v ?? "").replaceAll('"', '""')}"`;
    const linjer = [
      ["Kunde", "Andeler", "Brukere", "Aktive 30 d", "Hendelser 30 d", "Sist innlogget", "Årssum", "Helse"].join(";"),
      ...tabell.map((k) =>
        [
          felt(k.navn), felt(k.andeler), felt(k.brukere), felt(k.aktive30), felt(k.hendelser30),
          felt(k.sistInnlogget ? dato(k.sistInnlogget) : "Aldri"), felt(k.arssum ?? 0), felt(helse(k)),
        ].join(";"),
      ),
    ];
    const blob = new Blob(["\uFEFF" + linjer.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `kundehelse-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <Ramme tittel="Statistikk">
      {feil && <div className="feilmelding">{feil}</div>}
      {!data ? (
        <p className="pf-dempet">Henter …</p>
      ) : (
        <>
          <div style={{ display: "flex", gap: "14px", alignItems: "center", flexWrap: "wrap" }}>
            <p className="pf-dempet" style={{ maxWidth: "74ch" }}>
              Hvordan forretningen og produktet faktisk står. Tall om kundenes eget arbeid,
              som antall åpne avvik, hører hjemme hos kunden — ikke her.
            </p>
            <button
              className="btn btn-ghost"
              style={{ marginLeft: "auto" }}
              onClick={eksporter}
              disabled={tabell.length === 0}
            >
              Eksporter
            </button>
          </div>

          <div className="pf-verktoylinje">
            {([30, 90, 365] as const).map((p) => (
              <button
                key={p}
                className={`pf-chip${periode === p ? " valgt" : ""}`}
                onClick={() => setPeriode(p)}
              >
                {p === 365 ? "12 måneder" : `${p} dager`}
              </button>
            ))}
            {antallDemo > 0 && (
              <div style={{ marginLeft: "auto", minWidth: "280px", maxWidth: "420px" }}>
                <Bryter
                  etikett={`Ta med demo- og testkunder (${antallDemo})`}
                  beskrivelse="Gjelder nøkkeltallene og tabellen. Grafene holder dem alltid utenfor."
                  verdi={medDemo}
                  onEndre={setMedDemo}
                />
              </div>
            )}
          </div>

          <div className="pf-kpi-grid">
            <div className="pf-kpi">
              <div className="pf-kpi-etikett">Årlig inntekt</div>
              <div className="pf-kpi-verdi">{kroner(kpi.inntekt)}</div>
              <div className="pf-dempet">
                {kpi.nytt90 > 0 ? (
                  <>
                    <span style={{ color: "var(--ok)" }}>+{kroner(kpi.nytt90)}</span> fra avtaler
                    startet siste 90 dager
                  </>
                ) : (
                  "ingen nye avtaler siste 90 dager"
                )}
              </div>
              <Sparkline serie={serier.inntekt} farge="var(--ok)" />
            </div>
            <div className="pf-kpi">
              <div className="pf-kpi-etikett">Betalende kunder</div>
              <div className="pf-kpi-verdi">
                {kpi.betalende}{" "}
                <small style={{ fontSize: "var(--fs-sm)", color: "var(--muted)", fontWeight: 400 }}>
                  av {syn.length}
                </small>
              </div>
              <div className="pf-dempet">
                {syn.length - kpi.betalende} på pilot eller uten avtale
              </div>
              <Sparkline serie={serier.kunder} farge="var(--accent)" />
            </div>
            <div className="pf-kpi">
              <div className="pf-kpi-etikett">Andeler under forvaltning</div>
              <div className="pf-kpi-verdi">{kpi.andeler.toLocaleString("nb-NO")}</div>
              <div className="pf-dempet">
                {syn.length > 0 ? `Snitt ${Math.round(kpi.andeler / syn.length)} per kunde` : "—"}
              </div>
              <Sparkline serie={serier.andeler} farge="var(--pf)" />
            </div>
            <div className="pf-kpi">
              <div className="pf-kpi-etikett">Aktive brukere siste 30 dager</div>
              <div className="pf-kpi-verdi">
                {kpi.aktive}{" "}
                <small style={{ fontSize: "var(--fs-sm)", color: "var(--muted)", fontWeight: 400 }}>
                  av {kpi.brukere}
                </small>
              </div>
              <div className="pf-dempet">
                {kpi.aldri > 0 ? (
                  <>
                    <span style={{ color: "var(--danger)" }}>{kpi.aldri} styremedlemmer</span> har
                    aldri logget inn
                  </>
                ) : (
                  "alle har logget inn minst én gang"
                )}
              </div>
            </div>
          </div>

          <div className="pf-st-grid2">
            <div className="pf-kort">
              <div className="pf-kort-kropp">
                <h3 className="pf-kpi-etikett" style={{ margin: 0 }}>
                  Bruk over tid
                  <span style={{ fontWeight: 400, letterSpacing: 0, textTransform: "none", float: "right" }}>
                    Hendelser per {periode === 365 ? "måned" : "uke"}, uten demo-kunder
                  </span>
                </h3>
                <p className="pf-dempet" style={{ margin: "4px 0 14px" }}>
                  Registreringer i avvik, oppgaver, driftslogg, kontrakter og dokumentarkiv —
                  tallet som forteller om produktet er i bruk eller bare kjøpt.
                </p>
                {stolper.length === 0 ? (
                  <p className="pf-dempet">Ingen aktivitet i perioden.</p>
                ) : (
                  <>
                    <svg
                      width="100%"
                      height="170"
                      viewBox={`0 0 560 170`}
                      preserveAspectRatio="none"
                      style={{ display: "block" }}
                      role="img"
                      aria-label="Stolpediagram over hendelser"
                    >
                      {stolper.map((s, i) => {
                        const maks = Math.max(hoyeste.n, 1);
                        const bw = 560 / stolper.length;
                        const h = (s.n / maks) * 132;
                        return (
                          <g key={i}>
                            <rect
                              x={i * bw + 4}
                              y={158 - h}
                              width={Math.max(bw - 8, 2)}
                              height={h}
                              rx="3"
                              fill={i === stolper.length - 1 ? "var(--ok)" : "var(--accent)"}
                              opacity={i === stolper.length - 1 ? 1 : 0.85}
                            />
                            {(stolper.length <= 8 || i % 2 === 0) && (
                              <text
                                x={i * bw + bw / 2}
                                y={168}
                                textAnchor="middle"
                                fontSize="9"
                                fill="var(--muted)"
                              >
                                {s.etikett}
                              </text>
                            )}
                          </g>
                        );
                      })}
                    </svg>
                    {hoyeste.n > 0 && (
                      <p className="pf-dempet" style={{ marginTop: "8px" }}>
                        Høyest i perioden: {periode === 365 ? hoyeste.etikett : `uken fra ${hoyeste.etikett}`} med{" "}
                        {hoyeste.n} hendelser.
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className="pf-kort">
              <div className="pf-kort-kropp">
                <h3 className="pf-kpi-etikett" style={{ margin: 0 }}>
                  Fra lead til kunde
                  <span style={{ fontWeight: 400, letterSpacing: 0, textTransform: "none", float: "right" }}>
                    Siste 12 måneder
                  </span>
                </h3>
                <p className="pf-dempet" style={{ margin: "4px 0 14px" }}>
                  Hvor mange kommer minst hit. <Link className="pf-lenke-inline" href="/plattform/leads">Åpne leads ›</Link>
                </p>
                {trakt.leads === 0 ? (
                  <p className="pf-dempet">Ingen leads siste 12 måneder.</p>
                ) : (
                  <>
                    <div className="pf-st-trakt">
                      {traktTrinn.map((t, i) => (
                        <div key={t.lbl} className={`pf-st-trinn${i === traktTrinn.length - 1 ? " siste" : ""}`}>
                          <span className="lbl">{t.lbl}</span>
                          <div
                            className="bar"
                            style={{ width: `${Math.max((t.n / trakt.leads) * 100, 8)}%` }}
                          >
                            {t.n}
                          </div>
                          {t.forrige !== null && t.forrige > 0 && (
                            <span className="pct">{Math.round((t.n / t.forrige) * 100)} %</span>
                          )}
                        </div>
                      ))}
                    </div>
                    {frafall.tap > 0 && (
                      <div className="pf-st-note">
                        Største frafall er mellom <b>{frafall.fra.toLowerCase()} og {frafall.til.toLowerCase()}</b> —{" "}
                        {frafall.tap} leads kom ikke videre.
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="pf-kort">
            <div className="pf-kort-kropp">
              <h3 className="pf-kpi-etikett" style={{ margin: 0 }}>
                Moduler: aktivert mot faktisk brukt
                <span style={{ fontWeight: 400, letterSpacing: 0, textTransform: "none", float: "right" }}>
                  Brukt siste 30 dager, uten demo-kunder
                </span>
              </h3>
              <p className="pf-dempet" style={{ margin: "4px 0 10px" }}>
                Moduler som er slått på men ikke brukt, er de som ryker først når kunden ser på
                fakturaen.
              </p>
              {moduler.map((m) => {
                const svak = m.aktivert > 0 && m.brukt / m.aktivert < 0.5;
                return (
                  <div key={m.nokkel} className="pf-st-mod">
                    <span className="nm">{modulEtikett(m.nokkel)}</span>
                    <div className="pf-st-spor">
                      <i className="akt" style={{ width: `${maksAktivert ? (m.aktivert / maksAktivert) * 100 : 0}%` }} />
                      <i className={`bruk${svak ? " svak" : ""}`} style={{ width: `${maksAktivert ? (m.brukt / maksAktivert) * 100 : 0}%` }} />
                    </div>
                    <span className="n">{m.brukt} av {m.aktivert}</span>
                    <span className="kr" style={{ color: m.inntekt ? undefined : "var(--muted)" }}>
                      {m.inntekt ? kroner(m.inntekt) : "inkludert"}
                    </span>
                  </div>
                );
              })}
              <div className="pf-st-tegn">
                <span><i style={{ background: "rgba(var(--accent-rgb), 0.28)" }} />Aktivert</span>
                <span><i style={{ background: "var(--accent)" }} />Brukt siste 30 dager</span>
                <span><i style={{ background: "var(--warn)" }} />Under halvparten bruker den</span>
              </div>
              {verstModul && verstModul.aktivert - verstModul.brukt > 0 && (
                <div className="pf-st-note">
                  <b>{modulEtikett(verstModul.nokkel)}</b> er aktivert hos {verstModul.aktivert}{" "}
                  kunder, men brukt av {verstModul.brukt} siste 30 dager.
                  {verstModul.inntekt > 0 && (
                    <> Verdt en samtale før neste fornyelse — den står for <b>{kroner(verstModul.inntekt)} i året</b>.</>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="pf-kort">
            <div className="pf-kort-hode">
              <span>Kundehelse</span>
              <span style={{ fontWeight: 400, letterSpacing: 0 }}>Sortert etter risiko</span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <div style={{ minWidth: "820px" }}>
                <div className="pf-st-rad hode">
                  <span>Kunde</span>
                  <span className="tall">Andeler</span>
                  <span className="tall">Aktive brukere</span>
                  <span className="tall">Hendelser 30 d</span>
                  <span>Sist innlogget</span>
                  <span className="tall">Årssum</span>
                  <span className="tall">Helse</span>
                </div>
                {tabell.map((k) => {
                  const h = helse(k);
                  const dagerSist = k.sistInnlogget ? (dagerSiden(k.sistInnlogget) ?? 0) : null;
                  return (
                    <div key={k.id} className="pf-st-rad">
                      <span style={{ minWidth: 0 }}>
                        <Link href={`/plattform/kunder/${k.id}`} className="pf-navn-lenke">
                          {k.navn}
                        </Link>
                        {k.demo && <span className="badge muted" style={{ marginLeft: "6px" }}>Demo</span>}
                      </span>
                      <span className="tall">{k.andeler ?? "—"}</span>
                      <span className="tall">{k.aktive30} av {k.brukere}</span>
                      <span className="tall">{k.hendelser30}</span>
                      <span style={{ color: dagerSist === null || dagerSist > 14 ? "var(--danger)" : "var(--muted)" }}>
                        {siden(k.sistInnlogget)}
                      </span>
                      <span className="tall">{k.arssum === null ? "—" : kroner(k.arssum)}</span>
                      <span className="tall">
                        <span className={`badge ${HELSE_MERKE[h]}`}>{h}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="pf-listefot">
              {tabell.length} aktive kunder{medDemo ? ", demo-kunder inkludert" : ""}
            </div>
          </div>
        </>
      )}
    </Ramme>
  );
}
