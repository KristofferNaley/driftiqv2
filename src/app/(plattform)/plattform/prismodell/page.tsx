"use client";

import { useEffect, useMemo, useState } from "react";
import { dato } from "@/components/felles";
import { api } from "@/lib/klient";
import { MENY, TILLEGGSMODULER, type ModulNokkel } from "@/lib/moduler";
import { STANDARD_MODULPRISER, grunnpakke, grunnpakkeSpesifisert, kroner, type Trinn } from "@/lib/prisregler";
import { Ramme } from "../ramme";

/**
 * Prismodellen — etter `mockups/prismodell-v3-mockup.html`.
 *
 * Tre grep fra mockupen som styrer formen:
 *
 *  1. «Fra andel» settes automatisk (forrige trinns «til» + 1), så hull og overlapp
 *     mellom trinnene ikke KAN oppstå — v2s første utgave lot begge redigeres fritt.
 *  2. Kalkulatoren, priskurven og eksempelprisene regner på det man er i ferd med å
 *     lagre, ikke det som er lagret — man ser konsekvensen før man forplikter seg.
 *  3. Hver lagring blir en VERSJON med autogenerert endringsnotat («Gulvpris hevet fra
 *     6 000 til 8 000 kr»), og konsekvenslinja nederst viser hva hver eksisterende kunde
 *     ville fått ved neste fornyelse.
 *
 * Kundens faktiske abonnement redigeres fortsatt i kundedetaljen — dette er standarden
 * nye avtaler regnes fra.
 */

type Versjon = {
  version: number;
  note: string | null;
  validFrom: string | null;
  createdBy: string | null;
  createdAt: string;
};

type Kunde = {
  id: string;
  navn: string;
  andeler: number | null;
  /** Dagens netto årssum fra kontrakten — null når kunden ikke har registrert avtale. */
  arssum: number | null;
  rabattProsent: number;
  moduler: string[];
};

type Panel = {
  gulvpris: number;
  trinn: Trinn[];
  modulpriser: Record<string, number>;
  varselmottakere: string[];
  versjoner: Versjon[];
  kunder: Kunde[];
  modulKunder: Record<string, number>;
};

/** Kort beskrivelse per tilleggsmodul — argumentet ved siden av prisen. */
const MODULTEKST: Partial<Record<ModulNokkel, string>> = {
  internkontroll: "Lovpålagt HMS",
  parkering: "Plasser og ventelister",
  ai_radgiver: "Rådgiver på egne data",
  vedlikehold: "Flerårig vedlikeholdsplan",
  arshjul: "Gjentakende oppgaver",
  driftslogg: "Kronologisk logg",
  dokumentarkiv: "Arkiv som følger bygget",
  rutiner: "Rutiner med QR-kvittering",
};

const modulNavn = (n: string) => MENY[n as ModulNokkel]?.etikett ?? n;

function iDag(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

export default function Prismodellsiden() {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [feil, setFeil] = useState<string | null>(null);

  useEffect(() => {
    api
      .hent<Panel>("/plattform/prismodell")
      .then(setPanel)
      .catch((e) => setFeil(e instanceof Error ? e.message : "Kunne ikke hente prismodellen"));
  }, []);

  return (
    <Ramme tittel="Prismodell">
      {feil && <div className="feilmelding">{feil}</div>}
      {!panel ? (
        <p className="pf-dempet">Henter …</p>
      ) : (
        <Redigering panel={panel} onLagret={setPanel} />
      )}
    </Ramme>
  );
}

function Redigering({ panel, onLagret }: { panel: Panel; onLagret: (p: Panel) => void }) {
  const [gulvpris, setGulvpris] = useState(panel.gulvpris);
  // Bare «til» og «sats» redigeres — «fra» utledes, så hull og overlapp ikke kan oppstå.
  const [trinnRaa, setTrinnRaa] = useState(panel.trinn.map((t) => ({ til: t.til, sats: t.sats })));
  const [modulpriser, setModulpriser] = useState(panel.modulpriser);
  // Sist brukte pris per modul, så en bryter av-og-på ikke nuller det man skrev.
  const [huskPris, setHuskPris] = useState<Record<string, number>>({});
  const [gjelderFra, setGjelderFra] = useState(iDag());
  const [simAndeler, setSimAndeler] = useState(150);
  const [visKunder, setVisKunder] = useState(false);
  const [lagrer, setLagrer] = useState(false);
  const [feil, setFeil] = useState<string | null>(null);
  const [mottakerInput, setMottakerInput] = useState("");
  const [mottakere, setMottakere] = useState(panel.varselmottakere);

  const trinn: Trinn[] = useMemo(() => {
    let fra = 1;
    return trinnRaa.map((t) => {
      const rad = { fra, til: t.til, sats: t.sats };
      fra = t.til + 1;
      return rad;
    });
  }, [trinnRaa]);

  const trinnFeil = useMemo(() => {
    for (let i = 0; i < trinn.length; i++) {
      if (trinn[i]!.til < trinn[i]!.fra) {
        return `Trinn ${i + 1} slutter før det begynner — «til andel» må være minst ${trinn[i]!.fra}.`;
      }
    }
    return null;
  }, [trinn]);

  const endret = useMemo(
    () =>
      JSON.stringify({ g: gulvpris, t: trinn, m: modulpriser }) !==
      JSON.stringify({ g: panel.gulvpris, t: panel.trinn, m: panel.modulpriser }),
    [gulvpris, trinn, modulpriser, panel],
  );

  const sisteVersjon = panel.versjoner[0] ?? null;
  const nesteVersjon = (sisteVersjon?.version ?? 0) + 1;
  const medAvtale = panel.kunder.filter((k) => k.arssum !== null);
  const sisteTil = trinn[trinn.length - 1]?.til ?? 0;

  /* ── Kalkulator og kurve regner på det UREDIGERTE hvis trinnene er ugyldige ── */
  const regnetrinn = trinnFeil ? panel.trinn : trinn;
  const pris = (a: number) => grunnpakke(a, gulvpris, regnetrinn);
  const linjer = grunnpakkeSpesifisert(simAndeler, regnetrinn);
  const sum = pris(simAndeler);
  const gulvSlarInn = linjer.reduce((n, l) => n + l.sum, 0) < gulvpris;
  const betaltModulsum = TILLEGGSMODULER.reduce((n, m) => n + (modulpriser[m] ?? 0), 0);

  /* ── Konsekvens for eksisterende kunder ── */
  const konsekvens = useMemo(
    () =>
      medAvtale
        .filter((k) => k.andeler !== null)
        .map((k) => {
          const nyBrutto =
            pris(k.andeler!) + k.moduler.reduce((n, m) => n + (modulpriser[m] ?? 0), 0);
          const ny = Math.round(nyBrutto * (1 - k.rabattProsent / 100));
          return { ...k, ny, diff: ny - (k.arssum ?? 0) };
        })
        .sort((a, b) => b.diff - a.diff),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [medAvtale, modulpriser, gulvpris, regnetrinn],
  );
  const sumIDag = konsekvens.reduce((n, k) => n + (k.arssum ?? 0), 0);
  const sumNy = konsekvens.reduce((n, k) => n + k.ny, 0);

  function forkast() {
    setGulvpris(panel.gulvpris);
    setTrinnRaa(panel.trinn.map((t) => ({ til: t.til, sats: t.sats })));
    setModulpriser(panel.modulpriser);
    setVisKunder(false);
    setFeil(null);
  }

  async function lagre() {
    setLagrer(true);
    setFeil(null);
    try {
      const nytt = await api.endre<Panel>("/plattform/prismodell", {
        gulvpris,
        trinn,
        modulpriser,
        gjelderFra,
      });
      onLagret(nytt);
      setVisKunder(false);
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke lagre prismodellen");
    } finally {
      setLagrer(false);
    }
  }

  async function lagreMottakere(neste: string[]) {
    try {
      setMottakere(await api.endre<string[]>("/plattform/varselmottakere", { epostadresser: neste }));
      setMottakerInput("");
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke lagre mottakerne");
    }
  }

  /* ── Priskurven ── */
  const kurveMaks = Math.max(600, ...panel.kunder.map((k) => k.andeler ?? 0));
  const kurveTopp = Math.max(pris(kurveMaks), 1);
  const kurvePunkter = useMemo(() => {
    const pts: string[] = [];
    for (let a = 1; a <= kurveMaks; a += Math.max(1, Math.round(kurveMaks / 60))) {
      pts.push(`${(a / kurveMaks) * 328 + 6},${130 - (pris(a) / kurveTopp) * 118}`);
    }
    return pts.join(" ");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gulvpris, regnetrinn, kurveMaks, kurveTopp]);

  return (
    <div style={{ paddingBottom: endret ? "90px" : 0 }}>
      {feil && <div className="feilmelding">{feil}</div>}

      <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap", marginBottom: "14px" }}>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          {sisteVersjon ? (
            <>
              <span className="badge ok">Versjon {sisteVersjon.version} er i bruk</span>
              {sisteVersjon.validFrom && (
                <span className="badge muted">Gjeldende fra {dato(sisteVersjon.validFrom)}</span>
              )}
            </>
          ) : (
            <span className="badge muted">Ingen versjoner lagret ennå — første lagring blir versjon 1</span>
          )}
          <span className="badge muted">{medAvtale.length} kunder med avtale</span>
        </div>
        <button
          className="btn btn-primary"
          style={{ marginLeft: "auto" }}
          disabled={!endret || Boolean(trinnFeil) || lagrer}
          onClick={() => void lagre()}
        >
          {lagrer ? "Lagrer …" : `Lagre som versjon ${nesteVersjon}`}
        </button>
      </div>

      <div className="pf-pm-split">
        <div style={{ display: "flex", flexDirection: "column", gap: "14px", minWidth: 0 }}>
          <div className="pf-kort">
            <div className="pf-kort-kropp">
              <h3 className="pf-kpi-etikett" style={{ margin: 0 }}>Grunnpakke</h3>
              <p className="pf-dempet" style={{ margin: "4px 0 14px" }}>
                Prisen alle kunder betaler for kjernemodulene, beregnet av antall andeler.
                Moduler med egen pris kommer i tillegg.
              </p>
              <div style={{ display: "flex", gap: "14px", alignItems: "flex-end", flexWrap: "wrap" }}>
                <div style={{ width: "170px" }}>
                  <label className="field-label" htmlFor="gulv">Gulvpris per år</label>
                  <input
                    id="gulv"
                    className="input"
                    type="number"
                    min={0}
                    value={gulvpris}
                    onChange={(e) => setGulvpris(parseInt(e.target.value, 10) || 0)}
                  />
                </div>
                <p className="pf-dempet" style={{ flex: 1, minWidth: "200px", margin: "0 0 8px" }}>
                  Laveste årspris uansett størrelse. Et lite sameie koster like mye å drifte
                  som et stort i alt annet enn andeler.
                </p>
              </div>
            </div>
          </div>

          <div className="pf-kort">
            <div className="pf-kort-kropp">
              <h3 className="pf-kpi-etikett" style={{ margin: 0 }}>Trinn</h3>
              <p className="pf-dempet" style={{ margin: "4px 0 14px" }}>
                Degressiv: hvert trinn gjelder bare andelene i sitt eget intervall — et lag
                med 200 andeler betaler full sats for de første 50. «Fra andel» settes
                automatisk, så det ikke kan oppstå hull eller overlapp.
              </p>
              <div className="pf-pm-trinnhode">
                <span>Fra andel</span><span>Til andel</span><span>Andel av kurven</span><span>Sats per andel</span><span />
              </div>
              {trinn.map((t, i) => (
                <div key={i} className="pf-pm-trinn">
                  <input className="input" value={t.fra} disabled aria-label={`Trinn ${i + 1}, fra andel (settes automatisk)`} />
                  <input
                    className="input"
                    type="number"
                    aria-label={`Trinn ${i + 1}, til andel`}
                    value={t.til}
                    onChange={(e) =>
                      setTrinnRaa(trinnRaa.map((r, j) =>
                        j === i ? { ...r, til: parseInt(e.target.value, 10) || 0 } : r,
                      ))
                    }
                  />
                  <div
                    className="stolpe"
                    style={{
                      width: `${Math.min(100, Math.max(2, ((t.til - t.fra + 1) / Math.max(sisteTil, 1)) * 100))}%`,
                      opacity: 0.9 - i * 0.15,
                    }}
                  />
                  <input
                    className="input"
                    type="number"
                    style={{ textAlign: "right" }}
                    aria-label={`Trinn ${i + 1}, sats per andel`}
                    value={t.sats}
                    onChange={(e) =>
                      setTrinnRaa(trinnRaa.map((r, j) =>
                        j === i ? { ...r, sats: parseInt(e.target.value, 10) || 0 } : r,
                      ))
                    }
                  />
                  <button
                    className="fjern"
                    onClick={() => setTrinnRaa(trinnRaa.filter((_, j) => j !== i))}
                    disabled={trinnRaa.length === 1}
                    title={trinnRaa.length === 1 ? "Modellen må ha minst ett trinn" : "Fjern trinnet"}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                className="pf-pm-nytttrinn"
                onClick={() => {
                  const siste = trinnRaa[trinnRaa.length - 1]!;
                  setTrinnRaa([
                    ...trinnRaa,
                    { til: siste.til + 200, sats: Math.max(10, Math.round(siste.sats * 0.7)) },
                  ]);
                }}
              >
                + Nytt trinn
              </button>
              {trinnFeil && <p style={{ color: "var(--danger)", fontSize: "var(--fs-label)", marginTop: "10px" }}>{trinnFeil}</p>}
              <p className="pf-dempet" style={{ marginTop: "10px", fontSize: "var(--fs-label)" }}>
                Lag med flere enn {sisteTil} andeler prises kun for de første {sisteTil} —
                utvid siste trinn hvis det dukker opp større lag.
              </p>
            </div>
          </div>

          <div className="pf-kort">
            <div className="pf-kort-kropp">
              <h3 className="pf-kpi-etikett" style={{ margin: 0 }}>Moduler med egen pris</h3>
              <p className="pf-dempet" style={{ margin: "4px 0 6px" }}>
                Slå på bryteren for å inkludere modulen i grunnpakken uten ekstra pris.
                Prisen er standard for nye avtaler — den enkelte kundes pris settes i
                kundedetaljen.
              </p>
              {TILLEGGSMODULER.map((m) => {
                const inkludert = (modulpriser[m] ?? 0) === 0;
                return (
                  <div key={m} className="pf-pm-modul">
                    <input
                      type="checkbox"
                      role="switch"
                      className="bryter-boks"
                      id={`inkl-${m}`}
                      checked={inkludert}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setHuskPris({ ...huskPris, [m]: modulpriser[m] ?? 0 });
                          setModulpriser({ ...modulpriser, [m]: 0 });
                        } else {
                          setModulpriser({
                            ...modulpriser,
                            [m]: huskPris[m] || STANDARD_MODULPRISER[m] || 5000,
                          });
                        }
                      }}
                    />
                    <label className="bryter" htmlFor={`inkl-${m}`} aria-hidden />
                    <span style={{ minWidth: 0 }}>
                      <span className="pf-navn">{modulNavn(m)}</span>
                      <span className="pf-under">
                        {MODULTEKST[m] ?? ""} · aktiv hos {panel.modulKunder[m] ?? 0} kunder
                      </span>
                    </span>
                    <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "8px" }}>
                      {inkludert ? (
                        <span className="pf-dempet">Inkludert</span>
                      ) : (
                        <>
                          <input
                            className="input"
                            type="number"
                            min={0}
                            style={{ width: "110px", textAlign: "right" }}
                            aria-label={`Årspris for ${modulNavn(m)}`}
                            value={modulpriser[m] ?? 0}
                            onChange={(e) =>
                              setModulpriser({ ...modulpriser, [m]: parseInt(e.target.value, 10) || 0 })
                            }
                          />
                          <span className="pf-dempet">kr/år</span>
                        </>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="pf-kort">
            <div className="pf-kort-kropp">
              <h3 className="pf-kpi-etikett" style={{ margin: 0 }}>Når endringen gjelder</h3>
              <p className="pf-dempet" style={{ margin: "4px 0 14px" }}>
                Nye kunder får den nye modellen fra datoen under. Eksisterende kunder
                beholder kontraktens pris til neste fornyelse — prisgaranti ut avtaleperioden.
              </p>
              <div style={{ width: "200px" }}>
                <label className="field-label" htmlFor="fra">Gjelder nye kunder fra</label>
                <input
                  id="fra"
                  className="input"
                  type="date"
                  value={gjelderFra}
                  onChange={(e) => setGjelderFra(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="pf-kort">
            <div className="pf-kort-kropp">
              <h3 className="pf-kpi-etikett" style={{ margin: 0 }}>Varsler om leads og innmeldinger</h3>
              <p className="pf-dempet" style={{ margin: "4px 0 10px" }}>
                Adressene som får e-post når det kommer en ny lead eller innmelding. Tom
                liste faller tilbake på adressen i miljøoppsettet.
              </p>
              {mottakere.map((adresse) => (
                <div key={adresse} className="pf-pm-rad">
                  <span>{adresse}</span>
                  <button
                    className="btn btn-ghost"
                    style={{ color: "var(--danger)", padding: "2px 8px" }}
                    onClick={() => void lagreMottakere(mottakere.filter((a) => a !== adresse))}
                  >
                    Fjern
                  </button>
                </div>
              ))}
              <form
                style={{ display: "flex", gap: "8px", marginTop: "10px" }}
                onSubmit={(e) => {
                  e.preventDefault();
                  const adresse = mottakerInput.trim().toLowerCase();
                  if (adresse && !mottakere.includes(adresse)) {
                    void lagreMottakere([...mottakere, adresse]);
                  }
                }}
              >
                <input
                  className="input"
                  type="email"
                  style={{ flex: 1 }}
                  placeholder="navn@driftiq.no"
                  aria-label="Ny varselmottaker"
                  value={mottakerInput}
                  onChange={(e) => setMottakerInput(e.target.value)}
                />
                <button className="btn" disabled={!mottakerInput.trim()}>Legg til</button>
              </form>
            </div>
          </div>

          {panel.versjoner.length > 0 && (
            <div className="pf-kort">
              <div className="pf-kort-hode"><span>Historikk</span></div>
              <div className="pf-kort-kropp" style={{ paddingTop: "4px" }}>
                {panel.versjoner.map((v) => (
                  <div key={v.version} className="pf-pm-rad">
                    <span style={{ minWidth: 0 }}>
                      <span className="pf-navn">Versjon {v.version}</span>
                      <span className="pf-under">{v.note ?? "—"}{v.createdBy ? ` · ${v.createdBy}` : ""}</span>
                    </span>
                    <span className="pf-dempet" style={{ whiteSpace: "nowrap" }}>
                      {dato(v.validFrom ?? v.createdAt)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="pf-pm-klebrig">
          <div className="pf-kort">
            <div className="pf-kort-kropp">
              <h3 className="pf-kpi-etikett" style={{ margin: 0 }}>
                Regn ut
                <span style={{ fontWeight: 400, letterSpacing: 0, textTransform: "none", float: "right" }}>
                  {simAndeler > 0 ? `${Math.round(sum / simAndeler)} kr per andel` : ""}
                </span>
              </h3>
              <label className="field-label" htmlFor="sim" style={{ marginTop: "8px", display: "block" }}>
                Antall andeler: <b>{simAndeler}</b>
              </label>
              <input
                id="sim"
                type="range"
                min={1}
                max={Math.max(600, sisteTil)}
                value={simAndeler}
                style={{ width: "100%", accentColor: "var(--accent)" }}
                onChange={(e) => setSimAndeler(parseInt(e.target.value, 10))}
              />
              {linjer.map((l, i) => (
                <div key={i} className="pf-pm-rad">
                  <span className="pf-dempet">Andel {l.fra}–{Math.min(simAndeler, l.til)}</span>
                  <span>
                    <span className="pf-dempet">{l.andelerITrinnet} × {l.sats} kr</span>{" "}
                    {kroner(l.sum)}
                  </span>
                </div>
              ))}
              {gulvSlarInn && (
                <div className="pf-pm-rad">
                  <span style={{ color: "var(--warn)" }}>Gulvprisen slår inn</span>
                  <span>{kroner(gulvpris)}</span>
                </div>
              )}
              <div className="pf-pm-total">
                <span className="pf-dempet">Grunnpakke per år</span>
                <span style={{ fontSize: "var(--fs-xl)", fontWeight: 700 }}>{kroner(sum)}</span>
              </div>
              <p className="pf-dempet" style={{ margin: "4px 0 0", fontSize: "var(--fs-label)" }}>
                Med alle betalte moduler: {kroner(sum + betaltModulsum)}
              </p>
            </div>
          </div>

          <div className="pf-kort">
            <div className="pf-kort-kropp">
              <h3 className="pf-kpi-etikett" style={{ margin: 0 }}>
                Priskurve
                <span style={{ fontWeight: 400, letterSpacing: 0, textTransform: "none", float: "right" }}>
                  Prikkene er dagens kunder
                </span>
              </h3>
              <svg
                width="100%"
                height="150"
                viewBox="0 0 340 150"
                style={{ display: "block", overflow: "visible", marginTop: "10px" }}
                role="img"
                aria-label="Årspris mot antall andeler"
              >
                <line x1="6" y1="130" x2="334" y2="130" stroke="var(--border)" />
                <polyline points={kurvePunkter} fill="none" stroke="var(--accent)" strokeWidth="2" />
                {panel.kunder
                  .filter((k) => k.andeler)
                  .map((k) => (
                    <circle
                      key={k.id}
                      cx={(k.andeler! / kurveMaks) * 328 + 6}
                      cy={130 - (pris(k.andeler!) / kurveTopp) * 118}
                      r="3.5"
                      fill="var(--ok)"
                    >
                      <title>{k.navn}: {kroner(pris(k.andeler!))}</title>
                    </circle>
                  ))}
                <text x="6" y="146" fill="var(--muted)" fontSize="10">1</text>
                <text x="330" y="146" fill="var(--muted)" fontSize="10" textAnchor="end">{kurveMaks}</text>
              </svg>
              <p className="pf-dempet" style={{ margin: "8px 0 0", fontSize: "var(--fs-label)" }}>
                Årspris mot antall andeler. Hold musen over en prikk for å se kunden.
              </p>
            </div>
          </div>

          <div className="pf-kort">
            <div className="pf-kort-kropp">
              <h3 className="pf-kpi-etikett" style={{ margin: 0 }}>Eksempelpriser</h3>
              {[10, 25, 50, 100, 200, 400, 600].map((a) => (
                <div key={a} className="pf-pm-rad">
                  <span className="pf-dempet">{a} andeler</span>
                  <span>
                    <span className="pf-dempet">{Math.round(pris(a) / a)} kr/andel</span>{" "}
                    {kroner(pris(a))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {endret && (
        <div className="pf-pm-konsekvens">
          <div className="linje">
            <span>
              Endringen påvirker <b>{konsekvens.length} kunder med avtale</b> — men først ved
              neste fornyelse.
            </span>
            <button className="btn btn-ghost" onClick={forkast}>Forkast</button>
            <button className="btn" onClick={() => setVisKunder((v) => !v)}>
              {visKunder ? "Skjul per kunde" : "Vis per kunde"}
            </button>
            <span style={{ marginLeft: "auto" }} className="pf-dempet">
              Årsinntekt ved fornyelse:{" "}
              <b style={{ color: "var(--text)" }}>{kroner(sumNy)}</b>{" "}
              <span style={{ color: sumNy > sumIDag ? "var(--ok)" : sumNy < sumIDag ? "var(--danger)" : "var(--muted)" }}>
                ({sumNy >= sumIDag ? "+" : ""}{kroner(sumNy - sumIDag)})
              </span>
            </span>
            <button
              className="btn btn-primary"
              disabled={Boolean(trinnFeil) || lagrer}
              onClick={() => void lagre()}
            >
              {lagrer ? "Lagrer …" : `Lagre som versjon ${nesteVersjon}`}
            </button>
          </div>
          {visKunder && (
            <div className="tabell">
              <div className="pf-pm-kunderad hode">
                <span>Kunde</span>
                <span className="tall">Andeler</span>
                <span className="tall">I dag</span>
                <span className="tall">Ny modell</span>
                <span className="tall">Endring</span>
                <span>Gjelder fra</span>
              </div>
              {konsekvens.map((k) => (
                <div key={k.id} className="pf-pm-kunderad">
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{k.navn}</span>
                  <span className="tall">{k.andeler}</span>
                  <span className="tall">{kroner(k.arssum ?? 0)}</span>
                  <span className="tall">{kroner(k.ny)}</span>
                  <span className="tall" style={{ color: k.diff > 0 ? "var(--ok)" : k.diff < 0 ? "var(--danger)" : "var(--muted)" }}>
                    {k.diff === 0 ? "uendret" : `${k.diff > 0 ? "+" : ""}${kroner(k.diff)}`}
                  </span>
                  <span className="pf-dempet">Neste fornyelse</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
