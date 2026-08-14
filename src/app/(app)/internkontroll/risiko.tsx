"use client";

/**
 * Risikovurderingen (§ 5 pkt. 6) — bygget om etter `mockups/risikovurdering-mockup.html`.
 *
 * Tre grep skiller den fra den gamle flate lista:
 *
 * 1. Matrisen er selve navigasjonen, ikke pynt: hver rute er en knapp som filtrerer lista.
 *    Styret ser fordelingen først og borer seg ned derfra.
 * 2. Skalaen er 1–3, ikke v1s 1–5 — se `skala` i lib/internkontroll.ts. Ordene står PÅ
 *    knappene i stedet for i et nedtrekk: den som vurderer skal velge mellom tre utsagn,
 *    ikke oversette en tallverdi i hodet.
 * 3. Redigeringen skjer i en skuff fra høyre i stedet for modal. Lista står til VENSTRE
 *    og matrisen til høyre: skuffen dekker matrisen, ikke lista man klikket i — så
 *    raden man redigerer er fortsatt synlig ved siden av skuffen.
 */

import { useEffect, useMemo, useState } from "react";
import { Feil, Tom, dato, useOrgData } from "@/components/felles";
import { Knapperad, Modal, Nedtrekk, Skuff, Tekstfelt, Tekstomrade, useSending } from "@/components/skjema";
import { internkontroll, type Fare, type HmsMal } from "@/lib/klient";

const SANNSYNLIGHET = ["Lite sannsynlig", "Mulig", "Sannsynlig"];
const KONSEKVENS = ["Liten", "Moderat", "Alvorlig"];
const NIVATEKST = { lav: "Lav", middels: "Middels", hoy: "Høy" } as const;
const NIVAMERKE = { lav: "ok", middels: "warn", hoy: "danger" } as const;
const FARESTATUS = [
  { verdi: "open", etikett: "Åpen" },
  { verdi: "mitigated", etikett: "Under kontroll" },
  { verdi: "closed", etikett: "Lukket" },
];
const TILTAKSSTATUS = [
  { verdi: "not_started", etikett: "Ikke startet" },
  { verdi: "in_progress", etikett: "Pågår" },
  { verdi: "done", etikett: "Utført" },
];

/** Klientkopi av lib/internkontroll.ts' `risikoniva` — lib-en drar med seg drizzle/zod. */
const niva = (tall: number): "lav" | "middels" | "hoy" =>
  tall <= 2 ? "lav" : tall <= 4 ? "middels" : "hoy";

/** Nærmeste frist blant farens åpne tiltak — det er den datoen styret styrer etter. */
function nesteFrist(f: Fare): string | null {
  const datoer = f.tiltak
    .filter((t) => t.status !== "done" && t.dueDate)
    .map((t) => t.dueDate!);
  return datoer.length ? datoer.reduce((a, b) => (a < b ? a : b)) : null;
}

export function Risiko() {
  const { data, feil, laster, last, orgId } = useOrgData((o) => internkontroll.farer(o));
  // null = lukket, { fare: null } = ny fare — skiller «ingen skuff» fra «tom skuff».
  const [skuff, setSkuff] = useState<{ fare: Fare | null } | null>(null);
  const [seeder, setSeeder] = useState(false);
  const [omrade, setOmrade] = useState<string | null>(null);
  const [celle, setCelle] = useState<{ s: number; k: number } | null>(null);
  /** null = den løpende driften (standardbildet); ellers et prosjektnavn. */
  const [kontekst, setKontekst] = useState<string | null>(null);
  const liste = data ?? [];

  const kontekster = useMemo(
    () => [...new Set((data ?? []).map((f) => f.context).filter((k): k is string => Boolean(k)))],
    [data],
  );

  // Kontekstfilteret er GRUNNLAGET: matrise, KPI-er og liste viser én vurdering isolert —
  // driftsbildet som standard, ett prosjekt når det er valgt.
  const grunnlag = liste.filter((f) => (kontekst === null ? !f.context : f.context === kontekst));

  const idag = new Date().toISOString().slice(0, 10);
  const hoye = grunnlag.filter((f) => f.status === "open" && f.niva === "hoy").length;
  const forfalte = grunnlag
    .filter((f) => f.status === "open")
    .flatMap((f) => f.tiltak)
    .filter((t) => t.status !== "done" && t.dueDate && t.dueDate < idag).length;
  const handtert = grunnlag.filter((f) => f.status !== "open").length;

  const omrader = [...new Set(grunnlag.map((f) => f.category).filter((k): k is string => Boolean(k)))];

  // Serveren sorterer (trenger vurdering først, så risiko synkende) — filtrene bevarer det.
  const synlige = grunnlag.filter(
    (f) =>
      (!omrade || f.category === omrade) &&
      (!celle || (f.probability === celle.s && f.consequence === celle.k)),
  );

  return (
    <>
      <Feil melding={feil} />

      {/* Vurderingsvelgeren: driftsbildet er standard, hvert prosjekt er sin egen
          avgrensede vurdering — matrise, KPI-er og liste følger valget. */}
      {kontekster.length > 0 && (
        <div className="rv-chips" style={{ padding: 0 }}>
          <button
            className={`rv-chip${kontekst === null ? " valgt" : ""}`}
            onClick={() => {
              setKontekst(null);
              setOmrade(null);
              setCelle(null);
            }}
          >
            Løpende drift
          </button>
          {kontekster.map((k) => (
            <button
              key={k}
              className={`rv-chip${kontekst === k ? " valgt" : ""}`}
              onClick={() => {
                setKontekst(kontekst === k ? null : k);
                setOmrade(null);
                setCelle(null);
              }}
            >
              {k}
            </button>
          ))}
        </div>
      )}

      <div className="kpi-grid">
        <Kpi farge="blaa" etikett="Registrerte risikoer" verdi={grunnlag.length} />
        <Kpi farge="roed" etikett="Høy risiko" verdi={hoye} under="åpne farer" />
        <Kpi farge="gul" etikett="Forfalte tiltak" verdi={forfalte} under="frist passert" />
        <Kpi farge="gronn" etikett="Håndtert" verdi={handtert} under="under kontroll eller lukket" />
      </div>

      <div className="rv-kolonner">
        <div className="card">
          <div className="card-header">
            <div className="card-title">Risikoer</div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
              <span className="rv-hint">{synlige.length} av {liste.length}</span>
              <button className="btn btn-ghost" onClick={() => setSeeder(true)}>
                Hent standard fareområder
              </button>
              <button className="btn btn-primary" onClick={() => setSkuff({ fare: null })}>
                Ny risiko
              </button>
            </div>
          </div>

          {omrader.length > 1 && (
            <div className="rv-chips">
              <button
                className={`rv-chip${omrade ? "" : " valgt"}`}
                onClick={() => setOmrade(null)}
              >
                Alle områder
              </button>
              {omrader.map((o) => (
                <button
                  key={o}
                  className={`rv-chip${omrade === o ? " valgt" : ""}`}
                  onClick={() => setOmrade(omrade === o ? null : o)}
                >
                  {o}
                </button>
              ))}
            </div>
          )}

          {celle && (
            <div className="rv-filterbar">
              <span>
                {(SANNSYNLIGHET[celle.s - 1] ?? "").toLowerCase()} · {(KONSEKVENS[celle.k - 1] ?? "").toLowerCase()} konsekvens
              </span>
              <button onClick={() => setCelle(null)}>Fjern filter</button>
            </div>
          )}

          {laster ? (
            <Tom tekst="Henter …" />
          ) : liste.length === 0 ? (
            <Tom tekst="Ingen farer kartlagt ennå. Start med standard fareområder — de lovpålagte er med der." />
          ) : synlige.length === 0 ? (
            <Tom tekst="Ingen risikoer i dette utvalget." />
          ) : (
            synlige.map((f) => {
              const frist = nesteFrist(f);
              const apneTiltak = f.tiltak.filter((t) => t.status !== "done").length;
              return (
                <button key={f.id} className="rv-rad" onClick={() => setSkuff({ fare: f })}>
                  <div style={{ minWidth: 0 }}>
                    <div className="list-tittel">{f.title}</div>
                    <div className="list-meta">
                      {f.tiltak.length === 0
                        ? f.niva !== "lav" && f.status === "open"
                          ? "Ingen tiltak — bør ha minst ett"
                          : "Ingen tiltak"
                        : apneTiltak
                          ? `${apneTiltak} åpne tiltak`
                          : "Alle tiltak utført"}
                      {f.owner ? ` · ${f.owner}` : ""}
                    </div>
                  </div>
                  <div className="rv-rad-omrade">{f.category ?? ""}</div>
                  <div className={`rv-rad-frist${frist && frist < idag ? " over" : ""}`}>
                    {frist ? dato(frist) : ""}
                  </div>
                  <div style={{ display: "flex", gap: "6px", justifyContent: "flex-end" }}>
                    {f.status !== "open" && (
                      <span className="badge muted">
                        {FARESTATUS.find((s) => s.verdi === f.status)?.etikett ?? f.status}
                      </span>
                    )}
                    {f.niva ? (
                      <>
                        {/* Vurderingen er over tolv måneder gammel — den årlige runden
                            sikres av at forfallet maser her, øverst i lista. */}
                        {f.trengerVurdering && <span className="badge warn">Vurder på nytt</span>}
                        <span className={`badge ${NIVAMERKE[f.niva]}`}>
                          {NIVATEKST[f.niva]} {f.risiko}
                        </span>
                      </>
                    ) : (
                      // Uvurdert skal SE uferdig ut — det er en oppfordring, ikke et nivå.
                      <span className="badge warn">Ikke vurdert</span>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <div className="card-title">Risikomatrise</div>
            <span className="rv-hint">Klikk en rute for å filtrere</span>
          </div>
          <div className="rv-matrise-kropp">
            <Matrise
              liste={grunnlag}
              celle={celle}
              onVelg={(s, k) =>
                setCelle(celle && celle.s === s && celle.k === k ? null : { s, k })
              }
            />
            <div className="rv-skala" aria-hidden>
              {SANNSYNLIGHET.map((o) => (
                <span key={o}>{o}</span>
              ))}
            </div>
            <div className="rv-legende">
              <div><i className="rv-prikk lav" /> Lav (1–2)</div>
              <div><i className="rv-prikk middels" /> Middels (3–4)</div>
              <div><i className="rv-prikk hoy" /> Høy (6–9)</div>
            </div>
          </div>
        </div>
      </div>

      {skuff && orgId && (
        <FareSkuff
          orgId={orgId}
          fare={skuff.fare}
          aktivKontekst={kontekst}
          onLukk={() => setSkuff(null)}
          onEndret={async () => {
            await last();
          }}
        />
      )}

      {seeder && orgId && (
        <SeedModal orgId={orgId} onLukk={() => setSeeder(false)} onLagret={last} />
      )}
    </>
  );
}

/** Samme lille kort som avvikssiden bruker — fargen styrer topplinja via `--kpi-farge`. */
function Kpi({
  farge,
  etikett,
  verdi,
  under,
}: {
  farge: string;
  etikett: string;
  verdi: number;
  under?: string;
}) {
  return (
    <div className={`card kpi-kort k-${farge}`} style={{ padding: "16px 18px" }}>
      <div className="kpi-etikett">{etikett}</div>
      <div className="kpi-verdi">{verdi}</div>
      {under && <div className="kpi-under">{under}</div>}
    </div>
  );
}

/** 3×3-rutenettet. Konsekvens vokser oppover (rad 3 øverst), sannsynlighet mot høyre. */
function Matrise({
  liste,
  celle,
  onVelg,
}: {
  liste: Fare[];
  celle: { s: number; k: number } | null;
  onVelg: (s: number, k: number) => void;
}) {
  return (
    <div className="rv-matrise" role="group" aria-label="Risikomatrise">
      <div className="rv-akse-y">Konsekvens</div>
      {[3, 2, 1].flatMap((k) =>
        [1, 2, 3].map((s) => {
          const tall = s * k;
          const antall = liste.filter((f) => f.probability === s && f.consequence === k).length;
          const aktiv = celle?.s === s && celle?.k === k;
          return (
            <button
              key={`${s}${k}`}
              className={`rv-celle ${niva(tall)}${antall ? "" : " tom"}${aktiv ? " aktiv" : ""}`}
              aria-pressed={aktiv}
              aria-label={`${KONSEKVENS[k - 1]} konsekvens, ${(SANNSYNLIGHET[s - 1] ?? "").toLowerCase()}: ${antall} risikoer`}
              onClick={() => onVelg(s, k)}
            >
              <span className="rv-celle-antall">{antall}</span>
              <span className="rv-celle-bunn">
                <span>{NIVATEKST[niva(tall)]}</span>
                <span className="rv-celle-tall">{tall}</span>
              </span>
            </button>
          );
        }),
      )}
      <div className="rv-akse-x">Sannsynlighet</div>
    </div>
  );
}

/** Tre utsagn ved siden av hverandre — den som vurderer velger ord, ikke tall. */
function Nivavelger({
  etikett,
  ord,
  verdi,
  onVelg,
}: {
  etikett: string;
  ord: string[];
  verdi: number | null;
  onVelg: (v: number) => void;
}) {
  return (
    <div className="field">
      <span className="field-label">{etikett}</span>
      <div className="rv-seg">
        {ord.map((o, i) => (
          <button
            key={o}
            type="button"
            className={verdi === i + 1 ? "valgt" : ""}
            aria-pressed={verdi === i + 1}
            onClick={() => onVelg(i + 1)}
          >
            <span className="rv-seg-tall">{i + 1}</span>
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Skuffen — redigerer én fare, eller oppretter en ny når `fare` er null.
 * Tiltakene lagres UMIDDELBART (egne rader); resten lagres samlet med «Lagre».
 */
function FareSkuff({
  orgId,
  fare,
  aktivKontekst,
  onLukk,
  onEndret,
}: {
  orgId: string;
  fare: Fare | null;
  /** Kontekstchipen som var valgt da skuffen åpnet — en ny fare havner i samme vurdering. */
  aktivKontekst: string | null;
  onLukk: () => void;
  onEndret: () => Promise<void>;
}) {
  const [tittel, setTittel] = useState(fare?.title ?? "");
  const [kategori, setKategori] = useState(fare?.category ?? "");
  const [prosjekt, setProsjekt] = useState(fare ? (fare.context ?? "") : (aktivKontekst ?? ""));
  const [beskrivelse, setBeskrivelse] = useState(fare?.description ?? "");
  // Ny fare starter uten valg — å måtte velge ER vurderingen, 2/2 som forvalg hadde
  // gitt en liste der alt står på middels uten at noen har ment det.
  const [s, setS] = useState<number | null>(fare ? fare.probability : null);
  const [k, setK] = useState<number | null>(fare ? fare.consequence : null);
  const [eier, setEier] = useState(fare?.owner ?? "");
  const [status, setStatus] = useState(fare?.status ?? "open");
  const [bekreftSlett, setBekreftSlett] = useState(false);
  const [feil, setFeil] = useState<string | null>(null);
  const [lagrer, setLagrer] = useState(false);

  const [tiltak, setTiltak] = useState(fare?.tiltak ?? []);
  const [nyttTiltak, setNyttTiltak] = useState("");

  const tall = s && k ? s * k : null;
  const nv = tall ? niva(tall) : null;

  async function lagre() {
    if (!s || !k) return;
    setLagrer(true);
    setFeil(null);
    const data = {
      title: tittel.trim(),
      category: kategori.trim() || null,
      description: beskrivelse.trim() || null,
      probability: s,
      consequence: k,
      owner: eier.trim() || null,
      status,
      context: prosjekt.trim() || null,
    };
    try {
      if (fare) await internkontroll.endreFare(orgId, fare.id, data);
      else await internkontroll.nyFare(orgId, data);
      await onEndret();
      onLukk();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke lagre");
    } finally {
      setLagrer(false);
    }
  }

  async function leggTilTiltak() {
    if (!fare) return;
    const t = nyttTiltak.trim();
    if (!t) return;
    try {
      await internkontroll.nyttTiltak(orgId, { hazardId: fare.id, title: t });
      setNyttTiltak("");
      await oppfriskTiltak();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke legge til tiltaket");
    }
  }

  async function settTiltak(id: string, felt: "status" | "dueDate" | "owner", verdi: string) {
    try {
      await internkontroll.endreTiltak(orgId, id, { [felt]: verdi || null });
      await oppfriskTiltak();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke lagre tiltaket");
    }
  }

  async function fjernTiltak(id: string) {
    try {
      await internkontroll.slettTiltak(orgId, id);
      await oppfriskTiltak();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke fjerne tiltaket");
    }
  }

  async function oppfriskTiltak() {
    if (!fare) return;
    await onEndret();
    const farer = await internkontroll.farer(orgId);
    setTiltak(farer.find((f) => f.id === fare.id)?.tiltak ?? []);
  }

  return (
    <>
      <Skuff
        tittel={fare ? "Rediger risiko" : "Ny risiko"}
        onLukk={onLukk}
        fot={
          <>
            {fare && (
              <button className="btn btn-ghost" style={{ color: "var(--danger)" }} onClick={() => setBekreftSlett(true)}>
                Slett …
              </button>
            )}
            <div style={{ flex: 1 }} />
            <button className="btn btn-ghost" onClick={onLukk}>
              Avbryt
            </button>
            <button
              className="btn btn-primary"
              onClick={() => void lagre()}
              disabled={lagrer || !tittel.trim() || !s || !k}
            >
              {lagrer ? "Lagrer …" : "Lagre"}
            </button>
          </>
        }
      >
        <Feil melding={feil} />

        {/* Tekstområde, ikke énlinjesfelt: lange titler skal kunne LESES, ikke scrolles. */}
        <Tekstomrade
          etikett="Hva kan gå galt? *"
          verdi={tittel}
          onEndre={setTittel}
          plassholder="For eksempel: rømningsvei blokkert av sykler"
        />
        <div className="field-row">
          <Tekstfelt etikett="Område" verdi={kategori} onEndre={setKategori} plassholder="Brannvern, el-sikkerhet …" />
          <Tekstfelt etikett="Ansvarlig" verdi={eier} onEndre={setEier} plassholder="Navn" />
        </div>

        <Tekstfelt
          etikett="Gjelder prosjekt"
          verdi={prosjekt}
          onEndre={setProsjekt}
          plassholder="Tomt = løpende drift"
          notat="Sett et prosjektnavn («Takrehabilitering 2027») for en avgrenset vurdering — den får sin egen fane over risikobildet."
        />

        <Nivavelger etikett="Sannsynlighet" ord={SANNSYNLIGHET} verdi={s} onVelg={setS} />
        <Nivavelger etikett="Konsekvens" ord={KONSEKVENS} verdi={k} onVelg={setK} />

        {fare?.lastAssessedAt && (
          <div className="field-note">
            Sist vurdert {dato(fare.lastAssessedAt)}
            {fare.trengerVurdering ? " — over tolv måneder siden; lagre en ny vurdering." : "."}
          </div>
        )}

        <div className="rv-resultat">
          <div>
            <div className="rv-resultat-txt">Risikonivå</div>
            <div className="rv-resultat-val">{nv ? `${NIVATEKST[nv]} risiko` : "Velg nivå"}</div>
          </div>
          <div className={`rv-resultat-tall${nv ? ` ${nv}` : ""}`}>{tall ?? "–"}</div>
        </div>

        <Tekstomrade
          etikett="Beskrivelse"
          verdi={beskrivelse}
          onEndre={setBeskrivelse}
          plassholder="Kort om situasjonen og hvem som kan bli berørt"
        />

        <Nedtrekk
          etikett="Status"
          verdi={status}
          onEndre={setStatus}
          valg={FARESTATUS}
          notat="«Åpen» følges opp. «Under kontroll» = tiltakene virker, dere lever med restrisikoen. «Lukket» = ikke lenger aktuell. De to siste teller som håndtert i oversikten — risikoen blir stående i lista som dokumentasjon."
        />

        <div className="field">
          <span className="field-label">Tiltak</span>
          {!fare ? (
            <div className="field-note">Lagre risikoen først — så kan tiltak legges til.</div>
          ) : (
            <>
              {tiltak.length === 0 && (
                <div className="field-note">
                  Ingen tiltak registrert{tall && tall >= 3 ? " — denne bør ha minst ett." : "."}
                </div>
              )}
              {tiltak.map((t) => (
                <div key={t.id} className="rv-tiltak">
                  <span className="list-tittel">{t.title}</span>
                  <div className="rv-tiltak-felter">
                    <select
                      className="select"
                      aria-label={`Status for ${t.title}`}
                      value={t.status}
                      onChange={(e) => void settTiltak(t.id, "status", e.target.value)}
                    >
                      {TILTAKSSTATUS.map((v) => (
                        <option key={v.verdi} value={v.verdi}>{v.etikett}</option>
                      ))}
                    </select>
                    <input
                      className="input"
                      type="date"
                      aria-label={`Frist for ${t.title}`}
                      value={t.dueDate ?? ""}
                      onChange={(e) => void settTiltak(t.id, "dueDate", e.target.value)}
                    />
                    <button
                      className="btn btn-ghost"
                      style={{ color: "var(--muted)", padding: "5px 9px" }}
                      onClick={() => void fjernTiltak(t.id)}
                      aria-label={`Fjern ${t.title}`}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
              <form
                style={{ display: "flex", gap: "8px", marginTop: "8px" }}
                onSubmit={(e) => {
                  e.preventDefault();
                  void leggTilTiltak();
                }}
              >
                <input
                  className="input"
                  style={{ flex: 1 }}
                  placeholder="Nytt tiltak — hva skal gjøres?"
                  aria-label="Nytt tiltak"
                  value={nyttTiltak}
                  onChange={(e) => setNyttTiltak(e.target.value)}
                />
                <button className="btn btn-ghost" disabled={!nyttTiltak.trim()}>
                  ＋
                </button>
              </form>
            </>
          )}
        </div>
      </Skuff>

      {bekreftSlett && fare && (
        <Modal tittel="Slett fare" onLukk={() => setBekreftSlett(false)} bredde={420}>
          <p style={{ fontSize: "var(--fs-sm)", lineHeight: 1.6, margin: 0 }}>
            Slett <strong>{fare.title}</strong>? Tiltakene slettes også. En fare som er
            håndtert bør heller settes til «Under kontroll» — historikken viser da at den ER
            vurdert.
          </p>
          <Knapperad
            onAvbryt={() => setBekreftSlett(false)}
            avbrytEtikett="Tilbake"
            sendEtikett="Slett"
            farlig
            onSend={() => {
              void (async () => {
                try {
                  await internkontroll.slettFare(orgId, fare.id);
                  await onEndret();
                  onLukk();
                } catch (e) {
                  setFeil(e instanceof Error ? e.message : "Kunne ikke slette");
                  setBekreftSlett(false);
                }
              })();
            }}
          />
        </Modal>
      )}
    </>
  );
}

/** Henter risikovurderingsmalen inn som lagets farer. */
function SeedModal({
  orgId,
  onLukk,
  onLagret,
}: {
  orgId: string;
  onLukk: () => void;
  onLagret: () => Promise<void>;
}) {
  const [maler, setMaler] = useState<HmsMal[] | null>(null);
  const [valgt, setValgt] = useState("");
  const [resultat, setResultat] = useState<{ opprettet: number; hoppetOver: number } | null>(null);
  const { sender, feil, send } = useSending(() => {});

  useEffect(() => {
    internkontroll
      .maler(orgId, "risikovurdering")
      .then((m) => {
        setMaler(m);
        setValgt(m.find((x) => x.isDefault)?.id ?? m[0]?.id ?? "");
      })
      .catch(() => setMaler([]));
  }, [orgId]);

  return (
    <Modal tittel="Hent standard fareområder" onLukk={onLukk} bredde={460}>
      {resultat ? (
        <>
          <p style={{ fontSize: "var(--fs-sm)", lineHeight: 1.6, margin: 0 }}>
            Hentet <b>{resultat.opprettet}</b> fareområde{resultat.opprettet === 1 ? "" : "r"}
            {resultat.hoppetOver > 0 && <> — {resultat.hoppetOver} fantes fra før</>}. Alle
            står som «ikke vurdert» øverst i lista til dere har tatt stilling — det er selve
            vurderingen.
          </p>
          <Knapperad onAvbryt={onLukk} avbrytEtikett="Lukk" sendEtikett="Ferdig" onSend={onLukk} />
        </>
      ) : (
        <>
          <Feil melding={feil} />
          {maler === null ? (
            <Tom tekst="Henter maler …" />
          ) : maler.length === 0 ? (
            <Tom tekst="Ingen risikovurderingsmal er lagt inn i plattformpanelet ennå." />
          ) : (
            <>
              <Nedtrekk
                etikett="Mal"
                verdi={valgt}
                onEndre={setValgt}
                valg={maler.map((m) => ({ verdi: m.id, etikett: m.isDefault ? `${m.name} (standard)` : m.name }))}
                notat="Malens fareområder kopieres inn som lagets egne — dere redigerer dem fritt etterpå. Farer dere alt har, hoppes over."
              />
              <Knapperad
                onAvbryt={onLukk}
                sendEtikett="Hent fareområder"
                sender={sender}
                deaktivert={!valgt}
                onSend={() =>
                  void send(async () => {
                    setResultat(await internkontroll.seedFarer(orgId, valgt));
                    await onLagret();
                  })
                }
              />
            </>
          )}
        </>
      )}
    </Modal>
  );
}
