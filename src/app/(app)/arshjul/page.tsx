"use client";

import { useMemo, useState } from "react";
import Layout from "@/components/Layout";
import { Faner, Feil, Tom, dato, useOrgData } from "@/components/felles";
import { Knapperad, Modal, Nedtrekk, Tekstfelt, Tekstomrade, useSending } from "@/components/skjema";
import { arshjul, oppgaver, type Arshjulsdata, type Hjulhendelse } from "@/lib/klient";
import { HJULKATEGORIER, KATEGORIER } from "@/lib/arshjulkategorier";
// Frekvensetikettene bor i den importfrie regelfila — «quarterly» er et kodenavn, ikke noe
// et styremedlem skal lese.
import { FREQ_ETIKETTER } from "@/lib/oppgaveregler";
import { useOkt } from "@/components/OktProvider";

/**
 * Årshjulet — året sett ovenfra.
 *
 * ## Hvorfor et månedsrutenett og ikke en liste
 *
 * En kronologisk liste svarer på «hva skjer neste gang». Årshjulet skal svare på noe annet:
 * «når på året er det travelt, og har vi glemt en hel årstid?». Det ser man bare når alle
 * tolv månedene står ved siden av hverandre — også de tomme. En måned uten hendelser er
 * informasjon, og i en liste finnes den ikke.
 *
 * ## Filteret, ikke to hjul
 *
 * Ett hjul blir fullt når både styrets frister og leverandørenes driftsoppgaver ligger i
 * det. v1 løste det med kategorifilter framfor to atskilte hjul, slik at kategoriene
 * beholder samme plass og farge uansett hva som er valgt. Samme løsning her.
 *
 * «Styrearbeid» er alt UNNTATT driftsoppgavene — det styret selv har ansvar for.
 */

const MANEDER = ["JAN", "FEB", "MAR", "APR", "MAI", "JUN", "JUL", "AUG", "SEP", "OKT", "NOV", "DES"];

const FILTRE = [
  { nokkel: "alle", etikett: "Alle" },
  { nokkel: "styrearbeid", etikett: "🏛 Styrearbeid" },
  { nokkel: "oppgave", etikett: "📋 Oppgaver" },
  { nokkel: "dugnad", etikett: "🧹 Dugnad" },
  { nokkel: "budsjett", etikett: "💰 Budsjett" },
  { nokkel: "frist", etikett: "⏰ Frister" },
  { nokkel: "hms", etikett: "🛡 HMS" },
] as const;

type Filter = (typeof FILTRE)[number]["nokkel"];

const passerer = (h: Hjulhendelse, f: Filter) =>
  f === "alle" ? true : f === "styrearbeid" ? h.kategori !== "oppgave" : h.kategori === f;

export default function Arshjul() {
  const { aktivOrg } = useOkt();
  const [aar, setAar] = useState(new Date().getFullYear());
  const [filter, setFilter] = useState<Filter>("alle");
  const [skjema, setSkjema] = useState<Hjulhendelse | "ny" | null>(null);
  // Hjulet, lista og oppgavevalget som FANER, ikke stablet på én side: hjulet trenger hele
  // bredden på mindre skjermer, og høyrekolonnen stjal den. Lista er et annet spørsmål
  // («hva er neste»), og hører like lite hjemme under hjulet som ved siden av.
  const [fane, setFane] = useState<"hjul" | "liste" | "oppgavevalg">("hjul");

  const { data, feil, setFeil, laster, last, orgId } = useOrgData(
    (o) => arshjul.hjul(o, aar),
    [aar],
  );

  const kanEndre = aktivOrg?.nivaa === "orgadmin" || aktivOrg?.nivaa === "redigering";
  const synlige = useMemo(
    () => (data?.hendelser ?? []).filter((h) => passerer(h, filter)),
    [data, filter],
  );

  const tellinger = useMemo(() => {
    const t: Record<string, number> = { alle: data?.hendelser.length ?? 0 };
    for (const f of FILTRE) {
      if (f.nokkel === "alle") continue;
      t[f.nokkel] = (data?.hendelser ?? []).filter((h) => passerer(h, f.nokkel)).length;
    }
    return t;
  }, [data]);

  return (
    <Layout
      tittel="Årshjul"
      handlinger={
        kanEndre ? (
          <button className="btn btn-primary" onClick={() => setSkjema("ny")}>
            ＋ Legg til hendelse
          </button>
        ) : undefined
      }
      subnav={
        <Faner
          valgt={fane}
          onVelg={setFane}
          faner={[
            { nokkel: "hjul", etikett: "Årshjul" },
            { nokkel: "liste", etikett: "Alle hendelser" },
            // Valget skriver til Oppgaver-modulen — uten redigeringsrett er fanen bare
            // en liste man ikke får gjort noe med.
            ...(kanEndre ? [{ nokkel: "oppgavevalg" as const, etikett: "Vis på årshjul" }] : []),
          ]}
        />
      }
    >
      <div className="page-content">
        <Feil melding={feil} />

        {fane !== "oppgavevalg" && (
          <>
            <p className="ah-intro">
              Oversikt over faste hendelser, frister og oppgaver gjennom året
              {aktivOrg ? ` — ${aktivOrg.name}` : ""} {aar}
            </p>

            <div className="ah-topp">
              <div className="ah-filtre">
                {FILTRE.map((f) => (
                  <button
                    key={f.nokkel}
                    className={`ah-chip${filter === f.nokkel ? " valgt" : ""}`}
                    onClick={() => setFilter(f.nokkel)}
                  >
                    {f.etikett} {tellinger[f.nokkel] ?? 0}
                  </button>
                ))}
              </div>
              <div className="ah-aar">
                <button className="btn btn-ghost" onClick={() => setAar(aar - 1)} aria-label="Forrige år">
                  ‹
                </button>
                <span>{aar}</span>
                <button className="btn btn-ghost" onClick={() => setAar(aar + 1)} aria-label="Neste år">
                  ›
                </button>
              </div>
            </div>
          </>
        )}

        {laster && !data ? (
          <Tom tekst="Henter …" />
        ) : fane === "oppgavevalg" ? (
          kanEndre && data && (
            <Oppgavevalg valg={data.oppgavevalg} orgId={orgId} onEndret={last} onFeil={setFeil} />
          )
        ) : fane === "hjul" ? (
          <>
            <div className="ah-rutenett">
              {MANEDER.map((navn, i) => {
                const iManeden = synlige.filter((h) => Number(h.dato.slice(5, 7)) === i + 1);
                return (
                  <div key={navn} className="ah-maned">
                    <div className="ah-maned-hode">
                      <span>{navn}</span>
                      <span className="ah-antall">{iManeden.length}</span>
                    </div>
                    {iManeden.length === 0 ? (
                      // En tom måned SKAL være synlig — det er halve poenget med hjulet.
                      <div className="ah-tom">Ingen hendelser</div>
                    ) : (
                      iManeden.map((h) => (
                        <button
                          key={h.id}
                          className="ah-brikke"
                          title={`${h.tittel} · ${dato(h.dato)}${h.under ? ` · ${h.under}` : ""}`}
                          // Bare manuelle hendelser kan redigeres her. De andre eies av
                          // modulen sin, og skal endres der de faktisk hører hjemme.
                          onClick={() => kanEndre && h.kilde === "manuell" && setSkjema(h)}
                          style={{ cursor: h.kilde === "manuell" && kanEndre ? "pointer" : "default" }}
                        >
                          <span
                            className="ah-prikk"
                            style={{ background: HJULKATEGORIER[h.kategori].farge }}
                            aria-hidden
                          />
                          <span className="ah-brikke-tekst">{h.tittel}</span>
                        </button>
                      ))
                    )}
                  </div>
                );
              })}
            </div>

            <div className="ah-legende">
              {(Object.keys(HJULKATEGORIER) as Array<keyof typeof HJULKATEGORIER>).map((k) => (
                <span key={k} className="ah-legende-punkt">
                  <span className="ah-prikk" style={{ background: HJULKATEGORIER[k].farge }} aria-hidden />
                  {HJULKATEGORIER[k].etikett}
                </span>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="card">
              <div className="card-header">
                <div>
                  <div className="card-title">Alle hendelser i {aar}</div>
                  <div className="field-note">
                    Kronologisk. Hendelser du har lagt inn selv kan redigeres — de som kommer
                    fra Oppgaver eller Internkontroll endres i modulen sin.
                  </div>
                </div>
              </div>
              {synlige.length === 0 ? (
                <Tom tekst="Ingen hendelser med dette filteret." />
              ) : (
                synlige.map((h) => (
                  <div key={h.id} className="ah-rad">
                    <span
                      className="ah-prikk"
                      style={{ background: HJULKATEGORIER[h.kategori].farge }}
                      aria-hidden
                    />
                    <span style={{ minWidth: 0 }}>
                      {h.kilde === "manuell" && kanEndre ? (
                        <button className="ah-rad-tittel lenke" onClick={() => setSkjema(h)}>
                          {h.tittel}
                        </button>
                      ) : (
                        <span className="ah-rad-tittel">{h.tittel}</span>
                      )}
                      <span className="ah-rad-meta">
                        {[
                          h.startDato ? `${dato(h.startDato)} – ${dato(h.dato)}` : dato(h.dato),
                          h.gjentas ? "gjentas årlig" : null,
                          h.under || null,
                          h.kilde === "oppgaver"
                            ? "Fra Oppgaver"
                            : h.kilde === "internkontroll"
                              ? "Fra Internkontroll"
                              : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                    <span className="ah-merke">{HJULKATEGORIER[h.kategori].etikett}</span>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>

      {skjema && orgId && (
        <HendelseModal
          orgId={orgId}
          hendelse={skjema === "ny" ? null : skjema}
          onLukk={() => setSkjema(null)}
          onLagret={() => {
            setSkjema(null);
            void last();
          }}
        />
      )}
    </Layout>
  );
}

// ── Høyremeny: hvilke oppgaver som vises ────────────────────────────────────────────────

function Oppgavevalg({
  valg,
  orgId,
  onEndret,
  onFeil,
}: {
  valg: Arshjulsdata["oppgavevalg"];
  orgId: string | undefined;
  onEndret: () => Promise<void>;
  onFeil: (f: string | null) => void;
}) {
  const [jobber, setJobber] = useState<string | null>(null);

  async function veksle(id: string, vises: boolean) {
    if (!orgId) return;
    setJobber(id);
    onFeil(null);
    try {
      await oppgaver.endre(orgId, id, { showOnArshjul: !vises });
      await onEndret();
    } catch (e) {
      onFeil(e instanceof Error ? e.message : "Kunne ikke endre synligheten");
    } finally {
      setJobber(null);
    }
  }

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <div className="card-title">Vis på årshjul</div>
          <div className="field-note">Fra Oppgaver-modulen</div>
        </div>
      </div>
      {valg.length === 0 ? (
        <Tom tekst="Ingen oppgaver registrert ennå." />
      ) : (
        valg.map((o) => (
          // Hele raden er label-en: i en smal kolonne er avkryssingsboksen alene et lite
          // treffområde, og tittelen står rett ved siden av.
          <label key={o.id} className="ah-oppgavevalg">
            <span style={{ minWidth: 0 }}>
              <span className="ah-rad-tittel">{o.tittel}</span>
              <span className="ah-rad-meta">
                {[FREQ_ETIKETTER[o.frekvens] ?? o.frekvens, o.leverandor]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
            <input
              type="checkbox"
              checked={o.vises}
              disabled={jobber === o.id}
              onChange={() => void veksle(o.id, o.vises)}
            />
          </label>
        ))
      )}
    </div>
  );
}

// ── Skjema ──────────────────────────────────────────────────────────────────────────────

function HendelseModal({
  orgId,
  hendelse,
  onLukk,
  onLagret,
}: {
  orgId: string;
  hendelse: Hjulhendelse | null;
  onLukk: () => void;
  onLagret: () => void;
}) {
  const [tittel, setTittel] = useState(hendelse?.tittel ?? "");
  const [beskrivelse, setBeskrivelse] = useState(hendelse?.under ?? "");
  // Bare de fire manuelle kan velges. Kommer hendelsen fra Oppgaver eller Internkontroll,
  // er den ikke redigerbar her uansett — men typen må være den smale for nedtrekket.
  const [kategori, setKategori] = useState<string>(
    hendelse && (KATEGORIER as readonly string[]).includes(hendelse.kategori)
      ? hendelse.kategori
      : "annet",
  );
  const [start, setStart] = useState(hendelse?.startDato ?? "");
  const [slutt, setSlutt] = useState(hendelse?.dato ?? "");
  const [gjentas, setGjentas] = useState(hendelse?.gjentas ?? false);
  const [bekreft, setBekreft] = useState(false);
  const { sender, feil, send } = useSending(onLagret);

  if (bekreft && hendelse) {
    return (
      <Modal tittel="Slett hendelse" onLukk={() => setBekreft(false)} bredde={380}>
        <p style={{ fontSize: "var(--fs-sm)", lineHeight: 1.6 }}>
          Slette «{hendelse.tittel}» fra årshjulet?
        </p>
        <Knapperad
          onAvbryt={() => setBekreft(false)}
          sendEtikett="Slett"
          farlig
          onSend={() => void send(() => arshjul.slett(orgId, hendelse.id))}
        />
      </Modal>
    );
  }

  return (
    <Modal tittel={hendelse ? "Rediger hendelse" : "Ny hendelse"} onLukk={onLukk}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const kropp = {
            title: tittel.trim(),
            description: beskrivelse.trim() || null,
            category: kategori,
            startDate: start || null,
            eventDate: slutt,
            isRecurring: gjentas,
          };
          void send(() =>
            hendelse ? arshjul.endre(orgId, hendelse.id, kropp) : arshjul.ny(orgId, kropp),
          );
        }}
      >
        {feil && <div className="feilmelding">{feil}</div>}
        <Tekstfelt etikett="Hva skjer? *" verdi={tittel} onEndre={setTittel} />
        <Tekstomrade etikett="Beskrivelse" verdi={beskrivelse} onEndre={setBeskrivelse} />
        <Nedtrekk
          etikett="Kategori"
          verdi={kategori}
          onEndre={setKategori}
          valg={KATEGORIER.map((k) => ({ verdi: k, etikett: HJULKATEGORIER[k].etikett }))}
        />
        <Tekstfelt
          etikett="Startdato"
          type="date"
          verdi={start}
          onEndre={setStart}
          notat="Valgfritt. Fylles den ut, dekker hendelsen en periode i stedet for én dag."
        />
        <Tekstfelt etikett="Dato / frist *" type="date" verdi={slutt} onEndre={setSlutt} />
        <label className="ah-oppgavevalg" style={{ padding: "10px 0" }}>
          <span className="ah-rad-tittel">Gjentas hvert år</span>
          <input type="checkbox" checked={gjentas} onChange={(e) => setGjentas(e.target.checked)} />
        </label>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px" }}>
          {hendelse ? (
            <button type="button" className="btn btn-ghost" onClick={() => setBekreft(true)}>
              Slett
            </button>
          ) : (
            <span />
          )}
          <Knapperad onAvbryt={onLukk} sender={sender} deaktivert={!tittel.trim() || !slutt} />
        </div>
      </form>
    </Modal>
  );
}
