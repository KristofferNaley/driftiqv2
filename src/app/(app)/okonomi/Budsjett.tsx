"use client";

import { useEffect, useState } from "react";
import { Feil, Kort, Tom, dato, useOrgData } from "@/components/felles";
import { Knapperad, Modal, Nedtrekk, Tekstfelt, Tekstomrade, useSending } from "@/components/skjema";
import { okonomi, type Budsjett as BudsjettType, type BudsjettDetalj, type Budsjettforslag, type Budsjettlinje } from "@/lib/klient";
import {
  LINJETYPER,
  LINJETYPE_ETIKETT,
  andelAvAaret,
  forventetHittil,
  kontoTekst,
  kroner,
  tilKronerTekst,
  tilOre,
  type Linjetype,
} from "@/lib/okonomiregler";
import Belopfelt, { belopFeil } from "./Belopfelt";

/**
 * Budsjettfanen. Ett budsjett per år; utkast redigeres linje for linje, vedtak låser det
 * og gjør det til grunnlaget for satsene («Beregn satser»). «Faktisk» per linje er de
 * godkjente fakturaene som er knyttet til linja.
 */
export default function Budsjett({ erAdmin }: { erAdmin: boolean }) {
  const { data: liste, feil, setFeil, laster, last, orgId } = useOrgData((o) => okonomi.budsjetter(o));
  const [valgtId, setValgtId] = useState<string | null>(null);
  const [detalj, setDetalj] = useState<BudsjettDetalj | null>(null);
  const [nytt, setNytt] = useState(false);
  const [vedta, setVedta] = useState(false);
  const [linje, setLinje] = useState<Budsjettlinje | "ny" | null>(null);
  const [forslag, setForslag] = useState(false);
  const [melding, setMelding] = useState<string | null>(null);

  // Standardvalget er årets budsjett — eller det nyeste når året ikke finnes.
  useEffect(() => {
    if (!liste || liste.length === 0) {
      setValgtId(null);
      return;
    }
    if (valgtId && liste.some((b) => b.id === valgtId)) return;
    const aar = new Date().getFullYear();
    setValgtId((liste.find((b) => b.year === aar) ?? liste[0]!).id);
  }, [liste, valgtId]);

  useEffect(() => {
    if (!orgId || !valgtId) {
      setDetalj(null);
      return;
    }
    let aktiv = true;
    okonomi
      .budsjett(orgId, valgtId)
      .then((d) => aktiv && setDetalj(d))
      .catch((e) => aktiv && setFeil(e instanceof Error ? e.message : "Kunne ikke hente budsjettet"));
    return () => {
      aktiv = false;
    };
  }, [orgId, valgtId, setFeil]);

  async function oppdater() {
    if (!orgId || !valgtId) return;
    await last();
    setDetalj(await okonomi.budsjett(orgId, valgtId));
  }

  async function utfor(fn: () => Promise<unknown>, tilbakemelding?: (r: unknown) => string) {
    if (!orgId) return;
    setFeil(null);
    setMelding(null);
    try {
      const r = await fn();
      if (tilbakemelding) setMelding(tilbakemelding(r));
      await oppdater();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Noe gikk galt");
    }
  }

  const utkast = detalj?.status === "utkast";
  const naa = new Date();
  // «Forventet hittil» gir bare mening for et år som er i gang — for i fjor er alt forventet,
  // for neste år ingenting, og da er kolonnen støy.
  const visForventet = detalj ? andelAvAaret(detalj.year, naa) > 0 && andelAvAaret(detalj.year, naa) < 1 : false;

  return (
    <>
      <Feil melding={feil} />
      {melding && <div className="ok-melding">{melding}</div>}

      <div className="avvik-filter">
        <div className="pille-gruppe" style={{ marginLeft: 0 }}>
          {(liste ?? []).map((b) => (
            <button
              key={b.id}
              className={`pille${valgtId === b.id ? " valgt" : ""}`}
              onClick={() => setValgtId(b.id)}
            >
              {b.year}
              {b.status === "vedtatt" ? " ✓" : ""}
            </button>
          ))}
        </div>
        {erAdmin && (
          <button className="btn btn-primary sok-hoyre" onClick={() => setNytt(true)}>
            ＋ Nytt budsjett
          </button>
        )}
      </div>

      {laster ? (
        <Tom tekst="Henter …" />
      ) : !liste || liste.length === 0 ? (
        <Kort tittel="Budsjett">
          <Tom tekst="Ingen budsjett ennå. Lag et for neste år — linjene følger Norsk Standard kontoplan, og felleskostnadene fordeles på seksjonene etter brøk når budsjettet er vedtatt." />
        </Kort>
      ) : !detalj ? (
        <Tom tekst="Henter …" />
      ) : (
        <>
          <div className="auto-grid">
            <Sum etikett="Kostnader" verdi={detalj.summer.kostnader} />
            <Sum etikett="Andre inntekter" verdi={detalj.summer.inntekter} />
            <Sum etikett="Felleskostnader" verdi={detalj.summer.felleskost} />
            <Sum
              etikett="Resultat"
              verdi={detalj.summer.resultat}
              tone={detalj.summer.resultat < 0 ? "danger" : detalj.summer.resultat > 0 ? "ok" : undefined}
            />
          </div>

          <Kort
            tittel={`Budsjett ${detalj.year}`}
            handling={
              <div className="ok-handlinger">
                <span className={`badge ${detalj.status === "vedtatt" ? "ok" : "warn"}`}>
                  {detalj.status === "vedtatt" ? `Vedtatt ${dato(detalj.adoptedDate)}` : "Utkast"}
                </span>
                {erAdmin && utkast && detalj.summer.resultat !== 0 && (
                  <button
                    className="btn btn-ghost"
                    title="Setter felleskostnadene lik kostnader minus andre inntekter, så budsjettet går i null"
                    onClick={() => {
                      const fk = detalj.linjer.find((l) => l.kind === "felleskost");
                      const beloep = Math.max(0, detalj.summer.kostnader - detalj.summer.inntekter);
                      void utfor(() =>
                        fk
                          ? okonomi.endreLinje(orgId!, detalj.id, fk.id, { amount: beloep })
                          : okonomi.nyLinje(orgId!, detalj.id, { kind: "felleskost", name: "Felleskostnader", accountFrom: 3601, amount: beloep }),
                      );
                    }}
                  >
                    Balanser
                  </button>
                )}
                {erAdmin && utkast && (
                  <button className="btn btn-ghost" onClick={() => setForslag(true)} title="Fyller kostnadslinjene fra avtalene og vedlikeholdsplanen">
                    Foreslå fra avtaler
                  </button>
                )}
                {erAdmin && utkast && (
                  <button className="btn btn-primary" onClick={() => setVedta(true)}>
                    Vedta budsjett
                  </button>
                )}
                {erAdmin && detalj.status === "vedtatt" && (
                  <>
                    <button
                      className="btn btn-primary"
                      onClick={() =>
                        void utfor(
                          () => okonomi.beregnSatser(orgId!, detalj.id),
                          (r) => {
                            const s = r as { beregnet: number; overstyrt: number; utenBrok: number };
                            return `Beregnet sats for ${s.beregnet} seksjoner${s.overstyrt ? `, ${s.overstyrt} overstyrte beholdt` : ""}${s.utenBrok ? `, ${s.utenBrok} uten brøk` : ""}. Se fanen Felleskostnader.`;
                          },
                        )
                      }
                    >
                      Beregn satser
                    </button>
                    <button
                      className="btn btn-ghost"
                      onClick={() => {
                        if (window.confirm("Gjenåpne budsjettet? Satsene som er regnet fra det står, men linjene kan endres igjen.")) {
                          void utfor(() => okonomi.gjenapne(orgId!, detalj.id));
                        }
                      }}
                    >
                      Gjenåpne
                    </button>
                  </>
                )}
              </div>
            }
          >
            {detalj.note && <div className="ok-notat">{detalj.note}</div>}

            {LINJETYPER.map((type) => {
              const linjer = detalj.linjer.filter((l) => l.kind === type);
              if (linjer.length === 0 && !utkast) return null;
              return (
                <div key={type} className="ok-gruppe">
                  <div className="ok-gruppe-hode">
                    <span>{LINJETYPE_ETIKETT[type]}</span>
                    {erAdmin && utkast && (
                      <button className="btn btn-ghost" onClick={() => setLinje({ ...tomLinje(type), id: "" } as Budsjettlinje)}>
                        ＋ Linje
                      </button>
                    )}
                  </div>
                  {linjer.length === 0 ? (
                    <Tom tekst="Ingen linjer." />
                  ) : (
                    <>
                      <div className="ok-linje-hode" aria-hidden>
                        <span>Post</span>
                        <span className="ok-linje-konto">Konto</span>
                        <span className="ok-belop-celle">Budsjett</span>
                        <span className="ok-belop-celle ok-linje-faktisk">{type === "kostnad" ? "Faktisk" : ""}</span>
                        <span className="ok-belop-celle ok-linje-faktisk">{type === "kostnad" ? (visForventet ? "Avvik" : "Rest") : ""}</span>
                        <span />
                      </div>
                      {linjer.map((l) => (
                        <LinjeRad
                          key={l.id}
                          linje={l}
                          aar={detalj.year}
                          visForventet={visForventet}
                          kanEndre={erAdmin && utkast}
                          onEndre={() => setLinje(l)}
                          onBelop={(ore) => utfor(() => okonomi.endreLinje(orgId!, detalj.id, l.id, { amount: ore }))}
                          onSlett={() => utfor(() => okonomi.slettLinje(orgId!, detalj.id, l.id))}
                        />
                      ))}
                      <div className="ok-linje-rad ok-linje-sum" aria-label={`Sum ${LINJETYPE_ETIKETT[type]}`}>
                        <span className="list-tittel">Sum {LINJETYPE_ETIKETT[type].toLowerCase()}</span>
                        <span className="ok-linje-konto" />
                        <span className="ok-belop-celle">{kroner(linjer.reduce((sum, l) => sum + l.amount, 0))}</span>
                        <span className="ok-belop-celle ok-linje-faktisk">
                          {type === "kostnad" ? kroner(linjer.reduce((sum, l) => sum + l.faktisk, 0)) : ""}
                        </span>
                        <span className="ok-belop-celle ok-linje-faktisk">
                          {type === "kostnad"
                            ? avvikTekst(
                                linjer.reduce((sum, l) => sum + (visForventet ? forventetHittil(l.amount, detalj.year, naa) : l.amount), 0),
                                linjer.reduce((sum, l) => sum + l.faktisk, 0),
                                visForventet,
                              )
                            : ""}
                        </span>
                        <span />
                      </div>
                    </>
                  )}
                </div>
              );
            })}

            {erAdmin && utkast && (
              <div className="ok-fot">
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    if (window.confirm(`Slette budsjettutkastet for ${detalj.year}?`)) {
                      void utfor(async () => {
                        await okonomi.slettBudsjett(orgId!, detalj.id);
                        setValgtId(null);
                      });
                    }
                  }}
                >
                  Slett utkast
                </button>
              </div>
            )}
          </Kort>
        </>
      )}

      {nytt && orgId && (
        <NyttBudsjettModal
          eksisterende={liste ?? []}
          onLukk={() => setNytt(false)}
          onLagre={async (d) => {
            const b = await okonomi.nyttBudsjett(orgId, d);
            await last();
            setValgtId(b.id);
          }}
        />
      )}

      {vedta && orgId && detalj && (
        <VedtaModal
          budsjett={detalj}
          onLukk={() => setVedta(false)}
          onLagre={async (adoptedDate) => {
            await okonomi.vedta(orgId, detalj.id, { adoptedDate });
            await oppdater();
          }}
        />
      )}

      {forslag && orgId && detalj && (
        <ForslagModal
          orgId={orgId}
          budsjett={detalj}
          onLukk={() => setForslag(false)}
          onBrukt={async (antall) => {
            setMelding(`Oppdaterte ${antall} ${antall === 1 ? "linje" : "linjer"} fra forslaget.`);
            await oppdater();
          }}
        />
      )}

      {linje && orgId && detalj && (
        <LinjeModal
          linje={linje === "ny" ? null : linje}
          onLukk={() => setLinje(null)}
          onLagre={async (d) => {
            if (linje !== "ny" && linje.id) await okonomi.endreLinje(orgId, detalj.id, linje.id, d);
            else await okonomi.nyLinje(orgId, detalj.id, d);
            await oppdater();
          }}
        />
      )}
    </>
  );
}

/**
 * Avvik mot forventet (eller rest mot budsjett): positivt = under, negativt = over. Vises
 * med fortegn så en linje som ligger over budsjettet leses som «−22 700», slik i et regnskap.
 */
function avvikTekst(grunnlag: number, faktisk: number, medFortegn: boolean) {
  const diff = grunnlag - faktisk;
  if (!medFortegn) return <span className={diff < 0 ? "ok-mangler" : undefined}>{kroner(diff)}</span>;
  return <span className={diff < 0 ? "ok-mangler" : diff > 0 ? "ok-bra" : undefined}>{diff > 0 ? "+" : ""}{kroner(diff)}</span>;
}

const tomLinje = (kind: Linjetype) => ({
  budgetId: "", kind, name: "", accountFrom: null, accountTo: null, amount: 0, note: null, sortOrder: 0, faktisk: 0,
});

function Sum({ etikett, verdi, tone }: { etikett: string; verdi: number; tone?: "ok" | "danger" }) {
  return (
    <div className="card">
      <div className="card-body">
        <div className="card-title">{etikett}</div>
        <div className={`nokkeltall-verdi ok-sum${tone ? ` ${tone}` : ""}`}>{kroner(verdi)}</div>
      </div>
    </div>
  );
}

/** Beløpet redigeres rett i raden — et budsjett fylles ut linje for linje, ikke i modaler. */
function LinjeRad({
  linje,
  aar,
  visForventet,
  kanEndre,
  onEndre,
  onBelop,
  onSlett,
}: {
  linje: Budsjettlinje;
  aar: number;
  visForventet: boolean;
  kanEndre: boolean;
  onEndre: () => void;
  onBelop: (ore: number) => Promise<void>;
  onSlett: () => Promise<void>;
}) {
  const [tekst, setTekst] = useState(tilKronerTekst(linje.amount));
  useEffect(() => setTekst(tilKronerTekst(linje.amount)), [linje.amount]);

  function lagre() {
    const ore = tilOre(tekst);
    if (ore === null || ore < 0) {
      setTekst(tilKronerTekst(linje.amount));
      return;
    }
    if (ore !== linje.amount) void onBelop(ore);
  }

  const grunnlag = visForventet ? forventetHittil(linje.amount, aar, new Date()) : linje.amount;
  return (
    <div className="ok-linje-rad">
      <div style={{ minWidth: 0 }}>
        {kanEndre ? (
          <button className="ok-linje-navn" onClick={onEndre} title="Endre navn og konto">
            {linje.name}
          </button>
        ) : (
          <span className="list-tittel">{linje.name}</span>
        )}
        {linje.note && <div className="list-meta">{linje.note}</div>}
      </div>
      <span className="ok-linje-konto list-meta">{kontoTekst(linje.accountFrom, linje.accountTo)}</span>
      <span className="ok-belop-celle">
        {kanEndre ? (
          <input
            className="input ok-belop-inline"
            inputMode="decimal"
            value={tekst}
            aria-label={`Beløp for ${linje.name}`}
            onChange={(e) => setTekst(e.target.value)}
            onBlur={lagre}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
        ) : (
          kroner(linje.amount)
        )}
      </span>
      <span className="ok-belop-celle ok-linje-faktisk list-meta">
        {linje.kind === "kostnad" ? kroner(linje.faktisk) : ""}
      </span>
      <span className="ok-belop-celle ok-linje-faktisk">
        {linje.kind === "kostnad" ? avvikTekst(grunnlag, linje.faktisk, visForventet) : ""}
      </span>
      <span className="ok-linje-handling">
        {kanEndre && (
          <button
            className="btn btn-ghost fjern-knapp"
            aria-label={`Slett ${linje.name}`}
            onClick={() => window.confirm(`Slette linja «${linje.name}»?`) && void onSlett()}
          >
            ✕
          </button>
        )}
      </span>
    </div>
  );
}

/**
 * Forslaget fra avtaler og vedlikeholdsplan. Styret ser grunnlaget per linje, velger
 * prisjustering, retter enkeltbeløp, og skriver først når de trykker «Bruk». Linjer uten
 * kilder står som de er — forslaget rører aldri noe det ikke har grunnlag for.
 */
function ForslagModal({
  orgId,
  budsjett,
  onLukk,
  onBrukt,
}: {
  orgId: string;
  budsjett: BudsjettDetalj;
  onLukk: () => void;
  onBrukt: (antall: number) => Promise<void>;
}) {
  const [prosent, setProsent] = useState("3");
  const [data, setData] = useState<Budsjettforslag | null>(null);
  const [valgt, setValgt] = useState<Record<string, string>>({});
  const [feil, setFeil] = useState<string | null>(null);
  const { sender, send } = useSending(onLukk);

  useEffect(() => {
    const p = Number(prosent.replace(",", "."));
    if (!Number.isFinite(p)) return;
    let aktiv = true;
    okonomi
      .forslag(orgId, budsjett.id, p)
      .then((f) => {
        if (!aktiv) return;
        setData(f);
        setValgt(Object.fromEntries(f.linjer.filter((l) => l.forslag !== null).map((l) => [l.lineId, tilKronerTekst(l.forslag!)])));
      })
      .catch((e) => aktiv && setFeil(e instanceof Error ? e.message : "Kunne ikke hente forslaget"));
    return () => {
      aktiv = false;
    };
  }, [orgId, budsjett.id, prosent]);

  const medKilder = data?.linjer.filter((l) => l.kilder.length > 0) ?? [];
  const sumForslag = medKilder.reduce((s, l) => s + (tilOre(valgt[l.lineId] ?? "") ?? 0), 0);
  const sumNaa = medKilder.reduce((s, l) => s + l.naavaerende, 0);

  return (
    <Modal tittel={`Forslag til budsjett ${budsjett.year}`} onLukk={onLukk} bredde={860}>
      <Feil melding={feil} />
      <div className="ok-handlinger" style={{ justifyContent: "space-between" }}>
        <p className="ok-tekst" style={{ padding: 0, flex: 1 }}>
          Kostnadslinjene fylles fra avtalene (etter konto og antall måneder avtalen gjelder i {budsjett.year}) og
          vedlikeholdsplanens tiltak for året. Fjorårets tall står til sammenligning.
        </p>
        <label className="list-meta" style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
          Justering
          <input className="input ok-belop-inline" style={{ width: "70px" }} inputMode="decimal" value={prosent} onChange={(e) => setProsent(e.target.value)} aria-label="Justering i prosent" />
          %
        </label>
      </div>

      {!data ? (
        <Tom tekst="Henter …" />
      ) : medKilder.length === 0 ? (
        <Tom tekst="Ingen avtaler eller vedlikeholdstiltak treffer budsjettlinjene. Sett konto på avtalene under Kontrakter, så dukker de opp her." />
      ) : (
        <div className="ok-forslag">
          <div className="ok-forslag-hode" aria-hidden>
            <span>Linje og grunnlag</span>
            <span className="ok-belop-celle">Nå</span>
            <span className="ok-belop-celle ok-forslag-fjor">I fjor / faktisk</span>
            <span className="ok-belop-celle">Forslag</span>
          </div>
          {medKilder.map((l) => (
            <div key={l.lineId} className="ok-forslag-rad">
              <div style={{ minWidth: 0 }}>
                <div className="list-tittel">{l.name}</div>
                {l.kilder.map((k, i) => (
                  <div key={i} className="list-meta">
                    {k.slag === "vedlikehold" ? "Vedlikeholdsplan: " : ""}
                    {k.navn} · {kroner(k.belop)}
                    {k.maaneder < 12 ? ` (${k.maaneder} mnd)` : ""}
                  </div>
                ))}
              </div>
              <span className="ok-belop-celle list-meta">{kroner(l.naavaerende)}</span>
              <span className="ok-belop-celle list-meta ok-forslag-fjor">
                {l.fjoraretsBudsjett !== null ? `${kroner(l.fjoraretsBudsjett)} / ${kroner(l.fjoraretsFaktisk)}` : "—"}
              </span>
              <span className="ok-belop-celle">
                <input
                  className="input ok-belop-inline"
                  inputMode="decimal"
                  aria-label={`Forslag for ${l.name}`}
                  value={valgt[l.lineId] ?? ""}
                  onChange={(e) => setValgt((v) => ({ ...v, [l.lineId]: e.target.value }))}
                />
              </span>
            </div>
          ))}
          <div className="ok-forslag-rad ok-linje-sum">
            <span className="list-tittel">Sum linjer med grunnlag</span>
            <span className="ok-belop-celle">{kroner(sumNaa)}</span>
            <span className="ok-forslag-fjor" />
            <span className="ok-belop-celle">{kroner(sumForslag)}</span>
          </div>
        </div>
      )}

      {data && data.utenom.length > 0 && (
        <div>
          <div className="field-label">Ikke med i forslaget</div>
          {data.utenom.map((a) => (
            <div key={a.id} className="list-meta">
              {a.title} — {a.grunn}
            </div>
          ))}
        </div>
      )}

      <Knapperad
        onAvbryt={onLukk}
        sender={sender}
        deaktivert={medKilder.length === 0}
        sendEtikett="Bruk forslagene"
        onSend={() =>
          void send(async () => {
            const linjer = medKilder.map((l) => {
              const ore = tilOre(valgt[l.lineId] ?? "");
              if (ore === null || ore < 0) throw new Error(`Ugyldig beløp for «${l.name}»`);
              return { lineId: l.lineId, amount: ore };
            });
            await okonomi.brukForslag(orgId, budsjett.id, linjer);
            await onBrukt(linjer.filter((l) => l.amount !== medKilder.find((m) => m.lineId === l.lineId)!.naavaerende).length);
          })
        }
      />
    </Modal>
  );
}

function NyttBudsjettModal({
  eksisterende,
  onLukk,
  onLagre,
}: {
  eksisterende: BudsjettType[];
  onLukk: () => void;
  onLagre: (d: { year: number; kopierFraId: string | null; note: string | null }) => Promise<void>;
}) {
  const neste = Math.max(new Date().getFullYear(), ...eksisterende.map((b) => b.year)) + (eksisterende.length ? 1 : 0);
  const [aar, setAar] = useState(String(neste));
  const [kopier, setKopier] = useState(eksisterende[0]?.id ?? "");
  const [notat, setNotat] = useState("");
  const { sender, feil, send } = useSending(onLukk);

  return (
    <Modal tittel="Nytt budsjett" onLukk={onLukk}>
      <form
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
        onSubmit={(e) => {
          e.preventDefault();
          void send(() => onLagre({ year: Number(aar), kopierFraId: kopier || null, note: notat.trim() || null }));
        }}
      >
        <Tekstfelt etikett="Regnskapsår" verdi={aar} onEndre={setAar} type="number" />
        <Nedtrekk
          etikett="Start fra"
          verdi={kopier}
          onEndre={setKopier}
          valg={[
            { verdi: "", etikett: "Standardlinjer (NS 4102) med tomme beløp" },
            ...eksisterende.map((b) => ({ verdi: b.id, etikett: `Kopi av budsjett ${b.year}` })),
          ]}
          notat="Linjene kan endres, slettes og legges til etterpå."
        />
        <Tekstomrade etikett="Notat" verdi={notat} onEndre={setNotat} rader={2} plassholder="F.eks. forutsetninger, planlagte prosjekter" />
        <Feil melding={feil} />
        <Knapperad onAvbryt={onLukk} sender={sender} sendEtikett="Opprett budsjett" />
      </form>
    </Modal>
  );
}

function VedtaModal({
  budsjett,
  onLukk,
  onLagre,
}: {
  budsjett: BudsjettDetalj;
  onLukk: () => void;
  onLagre: (adoptedDate: string) => Promise<void>;
}) {
  const [datoVerdi, setDatoVerdi] = useState(new Date().toISOString().slice(0, 10));
  const { sender, feil, send } = useSending(onLukk);
  return (
    <Modal tittel={`Vedta budsjett ${budsjett.year}`} onLukk={onLukk}>
      <form
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
        onSubmit={(e) => {
          e.preventDefault();
          void send(() => onLagre(datoVerdi));
        }}
      >
        <p className="ok-tekst">
          Vedtaket låser linjene. Felleskostnader på <strong>{kroner(budsjett.summer.felleskost)}</strong> fordeles
          på seksjonene etter brøk når du trykker «Beregn satser» etterpå.
          {budsjett.summer.resultat !== 0 && (
            <>
              {" "}
              Budsjettet går {budsjett.summer.resultat < 0 ? "med underskudd" : "med overskudd"} på{" "}
              {kroner(Math.abs(budsjett.summer.resultat))}.
            </>
          )}
        </p>
        <Tekstfelt etikett="Årsmøtedato" verdi={datoVerdi} onEndre={setDatoVerdi} type="date" />
        <Feil melding={feil} />
        <Knapperad onAvbryt={onLukk} sender={sender} sendEtikett="Vedta" />
      </form>
    </Modal>
  );
}

function LinjeModal({
  linje,
  onLukk,
  onLagre,
}: {
  linje: Budsjettlinje | null;
  onLukk: () => void;
  onLagre: (d: {
    kind: string; name: string; accountFrom: number | null; accountTo: number | null; amount: number; note: string | null;
  }) => Promise<void>;
}) {
  const ny = !linje?.id;
  const [kind, setKind] = useState<string>(linje?.kind ?? "kostnad");
  const [navn, setNavn] = useState(linje?.name ?? "");
  const [fra, setFra] = useState(linje?.accountFrom ? String(linje.accountFrom) : "");
  const [til, setTil] = useState(linje?.accountTo ? String(linje.accountTo) : "");
  const [belop, setBelop] = useState(linje ? tilKronerTekst(linje.amount) : "");
  const [notat, setNotat] = useState(linje?.note ?? "");
  const { sender, feil, send } = useSending(onLukk);

  return (
    <Modal tittel={ny ? "Ny budsjettlinje" : "Endre budsjettlinje"} onLukk={onLukk}>
      <form
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
        onSubmit={(e) => {
          e.preventDefault();
          void send(async () => {
            const f = belopFeil(belop || "0");
            if (f) throw new Error(f);
            await onLagre({
              kind,
              name: navn,
              accountFrom: fra ? Number(fra) : null,
              accountTo: til ? Number(til) : null,
              amount: tilOre(belop || "0")!,
              note: notat.trim() || null,
            });
          });
        }}
      >
        <Nedtrekk
          etikett="Type"
          verdi={kind}
          onEndre={setKind}
          valg={LINJETYPER.map((t) => ({ verdi: t, etikett: LINJETYPE_ETIKETT[t] }))}
          notat={kind === "felleskost" ? "Beløpet som fordeles på seksjonene etter brøk. Konto 3601, aldri mva." : undefined}
        />
        <Tekstfelt etikett="Navn" verdi={navn} onEndre={setNavn} plassholder="F.eks. Kommunale avgifter" />
        <div className="field-row">
          <Tekstfelt etikett="Konto fra" verdi={fra} onEndre={setFra} type="number" plassholder="6320" notat="NS 4102 — samme nummer som i Fiken og hos forretningsfører" />
          <Tekstfelt etikett="Konto til" verdi={til} onEndre={setTil} type="number" plassholder="6329" />
        </div>
        <Belopfelt etikett="Årsbeløp" verdi={belop} onEndre={setBelop} />
        <Tekstomrade etikett="Notat" verdi={notat} onEndre={setNotat} rader={2} />
        <Feil melding={feil} />
        <Knapperad onAvbryt={onLukk} sender={sender} sendEtikett={ny ? "Legg til" : "Lagre"} />
      </form>
    </Modal>
  );
}
