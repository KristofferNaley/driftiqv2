"use client";

import { startTransition, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CalendarDays, ChevronDown, ChevronRight, FileText, GripVertical, Images } from "lucide-react";
import { Feil, Kort, Rad, Tom, dato } from "@/components/felles";
import { Avkryssing, Felt as Skjemafelt, Nedtrekk, Skuff, Tekstfelt, useSending } from "@/components/skjema";
import { oppslagstavle, type Oppslag, type Skjerm, type Tavlehendelse, type Tavleside } from "@/lib/klient";
import { Bildesider } from "./Bildesider";
import {
  KATEGORI_BESKRIVELSE,
  KATEGORI_ETIKETT,
  BILDESEKUNDER,
  KATEGORIER,
  MAKS_TEKST,
  MAKS_TITTEL,
  STANDARD_BILDESEKUNDER,
  STANDARD_SEKUNDER,
  STATUS_ETIKETT,
  TEKST_VARSEL,
  VISNINGSMATER,
  VISNINGSMATE_ETIKETT,
  VISNINGSTIDER,
  bildeoppsummering,
  hendelseFeil,
  oppslagFeil,
  osloIDag,
  type Kategori,
  type Oppslagstype,
  type Visningsmate,
} from "@/lib/oppslagstavleregler";

/**
 * Innhold-fanen: det daglige. Oppslag og kalender, ingenting om hvor på skjermen det står —
 * det hører til skjermoppsettet.
 */

const STATUSFARGE = { na: "ok", planlagt: "info", utlopt: "muted" } as const;

/** Første bilde som miniatyr (med «+3» når det er flere), ellers et ikon etter typen. */
function Radikon({ orgId, p }: { orgId: string; p: Oppslag }) {
  if (p.kind === "bilder") {
    const forste = p.sider[0];
    return (
      <span className="ot-radikon" aria-hidden>
        {forste ? (
          <img
            src={oppslagstavle.sideSti(orgId, forste.id)}
            alt=""
            style={{ objectFit: forste.tilpasning === "hele" ? "contain" : "cover", objectPosition: `${forste.x}% ${forste.y}%` }}
          />
        ) : (
          <Images size={16} />
        )}
        {p.sider.length > 1 && <i>+{p.sider.length - 1}</i>}
      </span>
    );
  }
  const Ikon = p.category === "viktig" ? AlertTriangle : p.category === "arrangement" ? CalendarDays : FileText;
  return (
    <span className={`ot-radikon ${p.category ?? "info"}`} aria-hidden>
      <Ikon size={16} />
    </span>
  );
}

const typeEtikett = (p: Oppslag) =>
  p.kind === "bilder" ? (p.sider.length === 1 ? "Bilde" : `${p.sider.length} bilder`) : KATEGORI_ETIKETT[p.category ?? "info"];

const standardSekunder = (type: Oppslagstype) => (type === "bilder" ? STANDARD_BILDESEKUNDER : STANDARD_SEKUNDER);

export function Innhold({
  orgId,
  oppslag,
  hendelser,
  skjermer,
  kanRedigere,
  valgtOppslag,
  onEndret,
  onVelgOppslag,
  onVelgHendelse,
}: {
  orgId: string;
  oppslag: Oppslag[];
  hendelser: Tavlehendelse[];
  skjermer: Skjerm[];
  kanRedigere: boolean;
  /** Oppslaget forhåndsvisningen står på. */
  valgtOppslag: string | null;
  onEndret: () => void;
  onVelgOppslag: (p: Oppslag) => void;
  onVelgHendelse: (h: Tavlehendelse) => void;
}) {
  const [visUtlopte, setVisUtlopte] = useState(false);
  const [feil, setFeil] = useState<string | null>(null);
  const [drar, setDrar] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  // Rekkefølgen vises med en gang raden slippes; serveren bekrefter etterpå.
  const [lokal, setLokal] = useState<string[] | null>(null);
  useEffect(() => setLokal(null), [oppslag]);

  const navn = new Map(skjermer.map((s) => [s.id, s.navn]));
  const aktiveRaa = oppslag.filter((p) => p.status !== "utlopt");
  const aktive = lokal ? lokal.flatMap((id) => aktiveRaa.find((p) => p.id === id) ?? []) : aktiveRaa;
  const utlopte = oppslag.filter((p) => p.status === "utlopt");

  function slipp(maal: string) {
    const fra = aktive.findIndex((p) => p.id === drar);
    const til = aktive.findIndex((p) => p.id === maal);
    setDrar(null);
    setOver(null);
    if (fra < 0 || til < 0 || fra === til) return;
    const ider = aktive.map((p) => p.id);
    ider.splice(til, 0, ider.splice(fra, 1)[0]!);
    setLokal(ider);
    setFeil(null);
    oppslagstavle
      .settRekkefolge(orgId, ider)
      .then(onEndret)
      .catch((e: unknown) => {
        setLokal(null);
        setFeil(e instanceof Error ? e.message : "Kunne ikke lagre rekkefølgen");
      });
  }

  const rad = (p: Oppslag, kanDras: boolean) => (
    <div
      key={p.id}
      className={`list-item ot-oppslagrad${valgtOppslag === p.id ? " valgt" : ""}${drar === p.id ? " dras" : ""}${over === p.id && drar !== p.id ? " over" : ""}`}
      draggable={kanDras}
      onDragStart={(e) => {
        setDrar(p.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(e) => {
        if (!drar || !kanDras) return;
        e.preventDefault();
        setOver(p.id);
      }}
      onDrop={(e) => {
        e.preventDefault();
        if (kanDras) slipp(p.id);
      }}
      onDragEnd={() => {
        setDrar(null);
        setOver(null);
      }}
      onClick={() => onVelgOppslag(p)}
    >
      {kanDras && <GripVertical size={14} className="ot-grep" aria-hidden />}
      <Radikon orgId={orgId} p={p} />
      <div className="ot-oppslagrad-tekst">
        <div className="list-tittel">{p.title}</div>
        <div className="list-meta">
          {[
            typeEtikett(p),
            `${dato(p.showFrom)} til ${dato(p.showUntil)}`,
            !p.allScreens && p.screenIds.map((id) => navn.get(id) ?? "Fjernet skjerm").join(", "),
            p.displaySeconds !== standardSekunder(p.kind) && `${p.displaySeconds} sek${p.kind === "bilder" ? " per bilde" : ""}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </div>
      <span className={`badge ${STATUSFARGE[p.status]}`}>{STATUS_ETIKETT[p.status]}</span>
    </div>
  );

  return (
    <>
      <Feil melding={feil} />
      <Kort tittel="Oppslag">
        {aktive.length === 0 && (
          <Tom tekst={oppslag.length === 0 ? "Ingen oppslag ennå. Trykk «Nytt innhold» for å legge ut noe." : "Ingen aktive oppslag."} />
        )}
        {aktive.map((p) => rad(p, kanRedigere && aktive.length > 1))}
        {aktive.length > 1 && kanRedigere && (
          <div className="ot-listefot field-note">Dra radene for å endre rekkefølgen oppslagene vises i.</div>
        )}
        {utlopte.length > 0 && (
          <div className="ot-listefot">
            <button type="button" className="ot-lenke" onClick={() => setVisUtlopte((v) => !v)}>
              {visUtlopte ? "Skjul utløpte" : `Vis ${utlopte.length} ${utlopte.length === 1 ? "utløpt" : "utløpte"}`}
            </button>
          </div>
        )}
        {visUtlopte && utlopte.map((p) => rad(p, false))}
      </Kort>

      <Kort tittel="Kalender">
        {hendelser.length === 0 && <Tom tekst="Ingen kommende hendelser." />}
        {hendelser.map((h) => (
          <Rad
            key={h.id}
            tittel={h.title}
            meta={[dato(h.eventDate), h.eventTime && `kl. ${h.eventTime}`, h.place].filter(Boolean).join(" · ")}
            onClick={kanRedigere ? () => onVelgHendelse(h) : undefined}
          />
        ))}
      </Kort>
    </>
  );
}

// ---------------------------------------------------------------------------------------
// Sidepanelet: nytt innhold og redigering
// ---------------------------------------------------------------------------------------

/**
 * Det som skrives akkurat nå, slik forhåndsvisningen trenger det. Siden (`page.tsx`) legger
 * det inn i innholdet skjermen tegner, så styret ser oppslaget på skjermen før det er lagt ut.
 */
export type Innholdsutkast =
  | {
      slag: "oppslag";
      /** Id-en til oppslaget som redigeres, eller `UTKAST_ID` for et nytt. */
      id: string;
      type: Oppslagstype;
      tittel: string;
      tekst: string | null;
      kategori: Kategori;
      sekunder: number;
      alleSkjermer: boolean;
      skjermIder: string[];
      /** Bildeoppslag: sidene slik de står i panelet nå, visningsmåten, og bildet som er åpent stort. */
      sider: Tavleside[];
      visning: Visningsmate;
      visSideId: string | null;
    }
  | { slag: "hendelse"; id: string; tittel: string; dato: string; tid: string | null; sted: string | null };

export const UTKAST_ID = "utkast";

type Innholdstype = Oppslagstype | "hendelse";
type Periodevalg = "1" | "2" | "dato";

const TYPER: ReadonlyArray<readonly [Innholdstype, string, string]> = [
  ["tekst", "Tekst", "Oppslag med overskrift og tekst"],
  ["bilder", "Bilder og PDF", "Ett eller flere bilder, eller lysbilder fra en PDF"],
  ["hendelse", "Kalender", "Hendelse i kalenderfeltet"],
];

const plussDager = (fra: string, dager: number) => osloIDag(new Date(new Date(`${fra}T12:00:00`).getTime() + dager * 86_400_000));

/**
 * Nytt innhold, eller redigering av et oppslag eller en kalenderhendelse, som panel fra
 * høyre: forhåndsvisningen står synlig ved siden av og viser utkastet mens man skriver. Ved
 * redigering står typen fast, og sletting ligger i bunnlinja. Samme komponent for nytt og
 * endring.
 *
 * Et NYTT bildeoppslag er en kladd på serveren fra første fil er lastet opp (`postId`):
 * «Legg ut» publiserer den, «Avbryt» sletter den. Bildene selv lagres straks (se
 * `Bildesider`); resten av feltene venter på knappen i bunnlinja.
 *
 * Reglene (lengder, datoer) er `oppslagFeil`/`hendelseFeil` — de samme serveren bruker.
 */
export function OppslagSkjema({
  orgId,
  skjermer,
  eksisterende: e,
  hendelse: h,
  onUtkast,
  forhandsvisning,
  onLukk,
  onLagret,
}: {
  orgId: string;
  skjermer: Skjerm[];
  eksisterende: Oppslag | null;
  hendelse: Tavlehendelse | null;
  onUtkast: (u: Innholdsutkast | null) => void;
  /** Skjermen med utkastet, til «Forhåndsvis» på smal skjerm der panelet dekker alt. */
  forhandsvisning: ReactNode;
  onLukk: () => void;
  onLagret: () => void;
}) {
  const iDag = osloIDag();
  const [type, setType] = useState<Innholdstype>(h ? "hendelse" : (e?.kind ?? "tekst"));
  const [tittel, setTittel] = useState(h?.title ?? e?.title ?? "");
  const [tekst, setTekst] = useState(e?.body ?? "");
  const [kategori, setKategori] = useState<Kategori>(e?.category ?? "info");
  /** Oppslaget bildene hører til: det som redigeres, eller kladden for et nytt. */
  const [postId, setPostId] = useState<string | null>(e?.id ?? null);
  const kladd = useRef<Promise<string> | null>(null);
  const [sider, setSider] = useState<Tavleside[]>(e?.sider ?? []);
  const [valgtSide, setValgtSide] = useState<string | null>(null);
  const [visning, setVisning] = useState<Visningsmate>(e?.layoutMode ?? "bla");
  const fullforFjerning = useRef<(() => Promise<void>) | null>(null);
  const [fra, setFra] = useState(e?.showFrom ?? iDag);
  const [til, setTil] = useState(e?.showUntil ?? plussDager(iDag, 14));
  const [periode, setPeriode] = useState<Periodevalg>(e ? "dato" : "2");
  const [alle, setAlle] = useState(e?.allScreens ?? true);
  const [utvalg, setUtvalg] = useState<string[]>(e?.screenIds ?? []);
  const [sekunder, setSekunder] = useState(e?.displaySeconds ?? STANDARD_SEKUNDER);
  const [flere, setFlere] = useState(false);
  const [hDato, setHDato] = useState(h?.eventDate ?? iDag);
  const [hTid, setHTid] = useState(h?.eventTime ?? "");
  const [hSted, setHSted] = useState(h?.place ?? "");
  const [sletter, setSletter] = useState(false);
  const [viserSkjerm, setViserSkjerm] = useState(false);
  const { sender, feil, send } = useSending(onLagret);
  const redigerer = Boolean(e || h);
  const erBilder = type === "bilder";

  /** Kladden opprettes én gang, også når flere filer slippes samtidig. */
  function sikrePost(): Promise<string> {
    if (postId) return Promise.resolve(postId);
    kladd.current ??= oppslagstavle.nyBildekladd(orgId).then((k) => {
      setPostId(k.id);
      return k.id;
    });
    return kladd.current;
  }

  /** En kladd som ikke ble lagt ut, skal ikke bli liggende: slettes med bildene sine. */
  function forkastKladd() {
    if (e || !kladd.current) return;
    void kladd.current.then((id) => oppslagstavle.slettOppslag(orgId, id)).catch(() => {});
  }
  function lukk() {
    forkastKladd();
    onLukk();
  }

  function velgPeriode(valg: Periodevalg, fraDato = fra) {
    setPeriode(valg);
    if (valg !== "dato") setTil(plussDager(fraDato, valg === "1" ? 7 : 14));
  }

  // Utkastet til forhåndsvisningen, ved hver endring. Ryddes når panelet lukkes.
  //
  // Som OVERGANG, ikke en vanlig oppdatering: forhåndsvisningen haster ikke, og en synkron
  // oppdatering av siden fra en effekt for hvert tastetrykk fikk React til å tro at det var en
  // uendelig løkke ved rask skriving (feil 185) — tastetrykket ble da kastet, og bokstaver
  // falt ut av teksten. Funnet i klikkerunden 30.09.2026.
  useEffect(() => {
    const u: Innholdsutkast =
      type === "hendelse"
        ? { slag: "hendelse", id: h?.id ?? UTKAST_ID, tittel, dato: hDato, tid: hTid || null, sted: hSted || null }
        : {
            slag: "oppslag",
            id: postId ?? UTKAST_ID,
            type,
            tittel,
            tekst: tekst || null,
            kategori,
            sekunder,
            alleSkjermer: alle,
            skjermIder: utvalg,
            sider,
            visning,
            visSideId: valgtSide,
          };
    startTransition(() => onUtkast(u));
    // `onUtkast` er en stabil setter hos forelderen; `e` og `h` byttes aldri mens panelet står.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, tittel, tekst, kategori, sekunder, alle, utvalg, postId, sider, visning, valgtSide, hDato, hTid, hSted]);
  useEffect(() => () => startTransition(() => onUtkast(null)), [onUtkast]);

  function lagre(ev: React.FormEvent) {
    ev.preventDefault();
    void send(async () => {
      if (type === "hendelse") {
        const d = { tittel, dato: hDato, tid: hTid || null, sted: hSted || null };
        const ugyldig = hendelseFeil(d);
        if (ugyldig) throw new Error(ugyldig);
        return h ? oppslagstavle.endreHendelse(orgId, h.id, d) : oppslagstavle.nyHendelse(orgId, d);
      }
      const d = {
        type,
        tittel,
        tekst: type === "tekst" ? tekst || null : null,
        kategori,
        fra,
        til,
        alleSkjermer: alle,
        skjermIder: alle ? [] : utvalg,
        sekunder,
        visning,
      };
      const ugyldig = oppslagFeil(d);
      if (ugyldig) throw new Error(ugyldig);
      if (type === "tekst") {
        const lagret = e ? await oppslagstavle.endreOppslag(orgId, e.id, d) : await oppslagstavle.nyttTekstoppslag(orgId, d);
        forkastKladd();
        return lagret;
      }
      // Et bilde som venter på å bli fjernet, fjernes før oppslaget legges ut.
      await fullforFjerning.current?.();
      if (!postId || sider.length === 0) throw new Error("Legg til minst ett bilde");
      return oppslagstavle.endreOppslag(orgId, postId, d);
    });
  }

  const tegn = tekst.length;
  const skjermtekst = alle ? "alle skjermer" : `${utvalg.length} ${utvalg.length === 1 ? "skjerm" : "skjermer"}`;
  const flereOppsummert = erBilder
    ? [sider.length > 0 ? bildeoppsummering(sider.length, sekunder) : `${sekunder} sek per bilde`, !alle && skjermtekst].filter(Boolean).join(" · ")
    : `${sekunder} sek · ${skjermtekst}`;
  // Et oppslag med en tid utenfor lista (bilder flyttet over fra før 30.09.2026) beholder den til den endres.
  const tider: readonly number[] = erBilder ? BILDESEKUNDER : VISNINGSTIDER;
  const sekundvalg = (etikett: string, notat: string) => (
    <Nedtrekk
      etikett={etikett}
      verdi={String(sekunder)}
      onEndre={(v) => setSekunder(Number(v))}
      valg={[...new Set([...tider, sekunder])]
        .sort((a, b) => a - b)
        .map((n) => ({ verdi: String(n), etikett: `${n} sekunder${n === standardSekunder(erBilder ? "bilder" : "tekst") ? " (standard)" : ""}` }))}
      notat={notat}
    />
  );

  const fot = sletter ? (
    <>
      {feil && <div className="feilmelding ot-panelfot-feil">{feil}</div>}
      <span className="ot-panelfot-tekst">Slette for godt? Det forsvinner fra skjermene med en gang.</span>
      <button type="button" className="btn btn-ghost" disabled={sender} onClick={() => setSletter(false)}>
        Behold
      </button>
      <button
        type="button"
        className="btn btn-danger"
        disabled={sender}
        onClick={() => void send(() => (h ? oppslagstavle.slettHendelse(orgId, h.id) : oppslagstavle.slettOppslag(orgId, e!.id)))}
      >
        Slett
      </button>
    </>
  ) : (
    <>
      {feil && <div className="feilmelding ot-panelfot-feil">{feil}</div>}
      {redigerer && (
        <button type="button" className="btn btn-ghost" onClick={() => setSletter(true)}>
          Slett
        </button>
      )}
      <span className="ot-panelfot-luft" />
      <button type="button" className="btn btn-ghost ot-bare-smal" onClick={() => setViserSkjerm((v) => !v)}>
        {viserSkjerm ? "Tilbake til skjemaet" : "Forhåndsvis"}
      </button>
      <button type="button" className="btn btn-ghost" onClick={lukk}>
        Avbryt
      </button>
      <button type="submit" form="ot-innholdsskjema" className="btn btn-primary" disabled={sender}>
        {sender ? "Lagrer …" : redigerer ? "Lagre" : type === "hendelse" ? "Legg i kalenderen" : "Legg ut"}
      </button>
    </>
  );

  return (
    <Skuff
      tittel={h ? "Endre hendelse" : e ? "Endre oppslag" : "Nytt innhold"}
      onLukk={lukk}
      fot={fot}
      utenSlor
      klasse="ot-panel"
    >
      {viserSkjerm && <div className="ot-panel-skjerm ot-bare-smal">{forhandsvisning}</div>}
      {/* Skjult, ikke fjernet, mens skjermen vises: det som er skrevet skal stå når man går tilbake. */}
      <form id="ot-innholdsskjema" onSubmit={lagre} className={`ot-panelskjema${viserSkjerm ? " skjult-smal" : ""}`}>
        {!redigerer && (
          <div className="ot-typer">
            {TYPER.map(([n, t, b]) => (
              <button
                type="button"
                key={n}
                className={`ot-type${type === n ? " valgt" : ""}`}
                onClick={() => {
                  setType(n);
                  if (n !== "hendelse") setSekunder(standardSekunder(n));
                }}
              >
                <b>{t}</b>
                <span>{b}</span>
              </button>
            ))}
          </div>
        )}

        {type === "hendelse" ? (
          <>
            <Tekstfelt etikett="Hva" verdi={tittel} onEndre={setTittel} plassholder="F.eks. Åpent styremøte" />
            <div className="ot-to">
              <Tekstfelt etikett="Dato" type="date" verdi={hDato} onEndre={setHDato} />
              <Tekstfelt etikett="Klokkeslett" type="time" verdi={hTid} onEndre={setHTid} notat="Valgfritt" />
            </div>
            <Tekstfelt etikett="Hvor" verdi={hSted} onEndre={setHSted} plassholder="F.eks. Fellesrommet" />
          </>
        ) : (
          <>
            {erBilder && (
              <Bildesider
                orgId={orgId}
                postId={postId}
                sikrePost={sikrePost}
                start={e?.sider ?? []}
                valgt={valgtSide}
                onVelg={setValgtSide}
                onEndret={setSider}
                fullforRef={fullforFjerning}
              />
            )}
            <Skjemafelt etikett={erBilder ? "Navn i lista (valgfritt)" : "Overskrift"}>
              <input
                className="input"
                value={tittel}
                maxLength={MAKS_TITTEL}
                placeholder={erBilder ? "F.eks. Bilder fra dugnaden" : "F.eks. Vannet stenges torsdag"}
                onChange={(ev) => setTittel(ev.target.value)}
              />
              {erBilder && <div className="field-note">Vises bare i appen. Teksten på skjermen skriver du på hvert bilde.</div>}
            </Skjemafelt>
            {type === "tekst" && (
              <>
                <Skjemafelt etikett="Tekst">
                  <textarea
                    className="textarea"
                    rows={4}
                    value={tekst}
                    maxLength={Math.max(MAKS_TEKST, e?.body?.length ?? 0)}
                    onChange={(ev) => setTekst(ev.target.value)}
                  />
                  <div className="ot-tekstnotat">
                    <span className="field-note">Kort er best. Teksten leses i forbifarten.</span>
                    <span className={`ot-teller${tegn >= MAKS_TEKST ? " over" : tegn >= TEKST_VARSEL ? " naer" : ""}`}>
                      {tegn}/{MAKS_TEKST}
                    </span>
                  </div>
                </Skjemafelt>
                <Skjemafelt etikett="Type" notat={KATEGORI_BESKRIVELSE[kategori]}>
                  <div className="ot-valg" role="radiogroup" aria-label="Type">
                    {(["info", "viktig", "arrangement"] as const satisfies readonly (typeof KATEGORIER)[number][]).map((k) => (
                      <button
                        type="button"
                        key={k}
                        role="radio"
                        aria-checked={kategori === k}
                        className={kategori === k ? "valgt" : ""}
                        onClick={() => setKategori(k)}
                      >
                        <i className={`ot-fargeprikk ${k}`} aria-hidden />
                        {KATEGORI_ETIKETT[k]}
                      </button>
                    ))}
                  </div>
                </Skjemafelt>
              </>
            )}

            <Skjemafelt etikett="Periode">
              <div className="ot-valg" role="radiogroup" aria-label="Periode">
                {(
                  [
                    ["1", "1 uke"],
                    ["2", "2 uker"],
                    ["dato", "Til dato"],
                  ] as const
                ).map(([v, etikett]) => (
                  <button
                    type="button"
                    key={v}
                    role="radio"
                    aria-checked={periode === v}
                    className={periode === v ? "valgt" : ""}
                    onClick={() => velgPeriode(v)}
                  >
                    {etikett}
                  </button>
                ))}
              </div>
            </Skjemafelt>
            <div className="ot-to">
              <Tekstfelt
                etikett="Vis fra"
                type="date"
                verdi={fra}
                onEndre={(v) => {
                  setFra(v);
                  if (v) velgPeriode(periode, v);
                }}
              />
              <Tekstfelt
                etikett="Til og med"
                type="date"
                verdi={til}
                onEndre={(v) => {
                  setTil(v);
                  setPeriode("dato");
                }}
              />
            </div>

            <div className="ot-flere">
              <button type="button" className="ot-flere-hode" aria-expanded={flere} onClick={() => setFlere((v) => !v)}>
                {flere ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />}
                <b>Flere valg</b>
                {!flere && <span>{flereOppsummert}</span>}
              </button>
              {flere && (
                <div className="ot-flere-kropp">
                  {erBilder ? (
                    <>
                      <Skjemafelt
                        etikett="Visning"
                        notat={
                          visning === "rutenett"
                            ? "Viser opptil 4 bilder samtidig i store felt. I små felt blas bildene gjennom."
                            : "Ett bilde om gangen, med myk overgang."
                        }
                      >
                        <div className="ot-valg" role="radiogroup" aria-label="Visning">
                          {VISNINGSMATER.map((v) => (
                            <button
                              type="button"
                              key={v}
                              role="radio"
                              aria-checked={visning === v}
                              className={visning === v ? "valgt" : ""}
                              onClick={() => setVisning(v)}
                            >
                              {VISNINGSMATE_ETIKETT[v]}
                            </button>
                          ))}
                        </div>
                      </Skjemafelt>
                      {sekundvalg(
                        "Sekunder per bilde",
                        sider.length > 0 ? bildeoppsummering(sider.length, sekunder) : "Hvor lenge hvert bilde står.",
                      )}
                    </>
                  ) : (
                    sekundvalg("Visningstid", "Hvor lenge oppslaget står før skjermen går videre til neste.")
                  )}
                  <Avkryssing
                    etikett="Vis på alle skjermer"
                    verdi={alle}
                    onEndre={setAlle}
                    notat="Gjelder også skjermer som kobles til senere."
                  />
                  {!alle && (
                    <div className="ot-filter">
                      {skjermer.map((s) => (
                        <button
                          type="button"
                          key={s.id}
                          className={`ot-chip${utvalg.includes(s.id) ? " valgt" : ""}`}
                          onClick={() => setUtvalg((u) => (u.includes(s.id) ? u.filter((x) => x !== s.id) : [...u, s.id]))}
                        >
                          {s.navn}
                        </button>
                      ))}
                      {skjermer.length === 0 && <span className="field-note">Ingen skjermer er koblet til ennå.</span>}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </form>
    </Skuff>
  );
}
