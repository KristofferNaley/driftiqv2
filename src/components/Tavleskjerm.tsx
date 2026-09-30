"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  Apple,
  Bus,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudHail,
  CloudLightning,
  CloudMoon,
  CloudMoonRain,
  CloudRain,
  CloudRainWind,
  CloudSnow,
  CloudSun,
  CloudSunRain,
  Moon,
  Newspaper,
  Plane,
  Recycle,
  Ship,
  Sun,
  TrainFront,
  TramFront,
  Trash2,
  Wine,
  type LucideIcon,
} from "lucide-react";
import { avfallMerke } from "@/lib/avfallsregler";
import {
  KATEGORI_ETIKETT,
  KONTAKT_SEKUNDER,
  RUTENETT_ANTALL,
  SONE_SEKUNDER,
  STANDARD_SEKUNDER,
  STANDARD_SKALERING,
  finnTekstskala,
  lengsteOrd,
  skjermpalett,
  visKode,
  type Blokkdata,
  type Skjerminnhold,
} from "@/lib/oppslagstavleregler";
import { STRIPE, finnMal, standardFelt } from "@/lib/tavlemaler";
import { avgangstid, transportmiddel, vaersymbol } from "@/lib/vaerregler";

/**
 * Det beboeren ser på veggen. Brukes BÅDE av skjermen selv (`/skjerm`) og av
 * forhåndsvisningen i appen, så styret aldri ser en annen tavle enn den som henger i oppgangen.
 *
 * ## Maler og soner
 *
 * Skjermen deles etter malen (`lib/tavlemaler.ts`). Hva som står i hvert felt, har styret
 * valgt per skjerm (`skjerm.soner`). Flere blokker i samme
 * sone roterer (`SONE_SEKUNDER`). Stripen nederst har høyde etter innholdet og viser
 * blokkene KOMPAKT (én linje). En blokk uten data — tømmedager uten BIR-kobling, vær MET
 * ikke har svart på — hoppes over, og en sone uten noe å vise står tom i stedet for å vise
 * en tom boks.
 *
 * ## Mål
 *
 * Alt er i `--u` (1 % av skjermens bredde × skaleringen), ikke `--fs-*`: tavla skal se lik ut
 * på en 4K-skjerm, en Full HD-skjerm og i forhåndsvisningen. Innhold klippes innenfor sonen
 * sin; det dytter aldri naboene ut av skjermen.
 */
export function Tavleskjerm({
  innhold,
  kontaktbildeUrl,
  logoUrl,
  utenNett,
  markertSone,
  visOppslagId,
  laasOppslag,
  sideUrl,
  visSideId,
  visBlokk,
}: {
  innhold: Skjerminnhold;
  /**
   * URL til én side i et bildeoppslag — blob-URL på skjermen, API-sti i appen. `null` betyr
   * «ikke lastet ennå»: oppslaget holdes da utenfor rotasjonen, så det ikke blinker inn halvt.
   */
  sideUrl: (sideId: string) => string | null;
  kontaktbildeUrl: (kontaktId: string) => string | null;
  logoUrl: string | null;
  /** Satt når skjermen ikke har fått svar på en stund: tidspunktet for siste vellykkede henting. */
  utenNett?: string | null;
  /** Bare forhåndsvisningen: feltet som er valgt i kartet, tegnes med ramme. */
  markertSone?: string | null;
  /** Bare forhåndsvisningen: hopp til dette oppslaget (raden styret klikket på). */
  visOppslagId?: string | null;
  /** Bare forhåndsvisningen: bli stående på `visOppslagId` (utkastet som skrives) i stedet for å rotere. */
  laasOppslag?: boolean;
  /** Bare forhåndsvisningen: bildet som er åpent i panelet. Oppslaget står da på det, uten rutenett. */
  visSideId?: string | null;
  /**
   * Bare forhåndsvisningen: blokken det skrives på akkurat nå («oppslag» eller «kalender»).
   * Et felt som roterer mellom flere blokker, blir da stående på den.
   */
  visBlokk?: string | null;
}) {
  const naa = useKlokke();
  const { skjerm, utseende } = innhold;
  const liggende = skjerm.retning === "liggende";
  // Innhold lagret av en skjerm før malene fantes, har ikke `mal`/`soner` — da gjelder standarden.
  const mal = finnMal(skjerm.mal ?? null, skjerm.retning);
  const soner = skjerm.soner ?? standardFelt(mal);
  const sistHentet = utenNett ? new Date(utenNett) : null;

  // Skaleringen ganges inn i `--u` (se `.ot-skjerm` i globals.css).
  const palett = {
    ...skjermpalett(utseende.background, utseende.accent),
    "--skala": String((skjerm.skala ?? STANDARD_SKALERING) / 100),
  } as CSSProperties;

  if (utenNett && utseende.offlineMode === "melding") {
    return (
      <div className={`ot-skjerm${liggende ? " liggende" : ""}`} style={palett}>
        <Topp innhold={innhold} naa={naa} logoUrl={logoUrl} />
        <div className="ot-midt">
          <h3>Skjermen har ikke kontakt med internett</h3>
          <p>Styret kan se det i DriftIQ.</p>
          <div className="ot-meta">{sistHentet && `Sist tilkoblet ${klokke(sistHentet)}`}</div>
        </div>
        <Fot tekst="Prøver igjen hvert minutt" />
      </div>
    );
  }

  const ctx: Kontekst = {
    innhold,
    naa,
    sideUrl,
    kontaktbildeUrl,
    visSideId: visSideId ?? null,
    visBlokk: visBlokk ?? null,
    visOppslagId: visOppslagId ?? null,
    laasOppslag: Boolean(laasOppslag && visOppslagId),
  };
  const harData = (n: string) => blokkHarData(n, innhold);
  const stripe = (soner[STRIPE] ?? []).filter(harData);
  const bredde = mal.omrader[0]!.split(" ").length;
  const grid: CSSProperties = {
    gridTemplateColumns: mal.kolonner,
    gridTemplateRows: `${mal.rader}${stripe.length ? " auto" : ""}`,
    gridTemplateAreas: [...mal.omrader, ...(stripe.length ? [Array(bredde).fill(STRIPE).join(" ")] : [])]
      .map((r) => `'${r}'`)
      .join(" "),
  };

  return (
    <div className={`ot-skjerm${liggende ? " liggende" : ""}`} style={palett}>
      <Topp innhold={innhold} naa={naa} logoUrl={logoUrl} />
      <div className="ot-kropp" style={grid}>
        {mal.soner.map((sone) => (
          <Sone key={sone} navn={sone} nokler={(soner[sone] ?? []).filter(harData)} ctx={ctx} markert={markertSone === sone} />
        ))}
        {stripe.length > 0 && <Stripe nokler={stripe} ctx={ctx} markert={markertSone === STRIPE} />}
      </div>
      <Fot tekst={sistHentet ? "" : `Oppdatert ${klokke(new Date(innhold.hentet))}`} />
      {sistHentet && (
        <div className="ot-utennett">
          <i />
          Ingen internett. Viser innhold fra {klokke(sistHentet)}.
        </div>
      )}
    </div>
  );
}

type Kontekst = {
  innhold: Skjerminnhold;
  naa: Date;
  sideUrl: (sideId: string) => string | null;
  kontaktbildeUrl: (kontaktId: string) => string | null;
  visSideId: string | null;
  visBlokk: string | null;
  visOppslagId: string | null;
  laasOppslag: boolean;
};

/** Om en blokk har noe å vise. Oppslag, kalender og kontakt viser alltid noe (også «ingen …»). */
function blokkHarData(nokkel: string, i: Skjerminnhold): boolean {
  if (nokkel === "oppslag" || nokkel === "kalender" || nokkel === "kontakt") return true;
  if (nokkel === "tommedager") return (i.avfall ?? null) !== null;
  const b = i.blokker?.[nokkel];
  if (!b) return false;
  return b.type === "vaer" ? b.varsel !== null : true;
}

/** Bredden av `ord` i elementets egen skrift ved gjeldende skala, uten linjebryting. */
function ordbredde(el: HTMLElement, ord: string): number {
  if (!ord) return 0;
  const maal = document.createElement("span");
  maal.textContent = ord;
  maal.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap;left:0;top:0";
  el.appendChild(maal);
  const b = maal.getBoundingClientRect().width;
  el.removeChild(maal);
  return b;
}

/**
 * Skalerer teksten i et oppslag så den fyller feltet: en kort beskjed blir stor, en lang blir
 * mindre, innenfor faste grenser. Utregningen er `finnTekstskala` (importfri og testet); her
 * er bare målingen i nettleseren, fordi feltets størrelse avhenger av mal, retning og
 * skalering. Det lengste ordet i overskrift og tekst måles først, så bredden setter taket.
 */
function useTilpassetTekst(nokkel: string) {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const tilpass = () => {
      el.classList.remove("klipp");
      if (el.clientHeight === 0) return;
      el.style.setProperty("--tekstskala", "1");
      const deler = [...el.querySelectorAll<HTMLElement>("h3, p")];
      const ord = deler.map((d) => ({ ordbredde: ordbredde(d, lengsteOrd(d.textContent ?? "")), feltbredde: d.clientWidth }));
      const { skala, klipp } = finnTekstskala({
        ord,
        passerIHoyden: (x) => {
          el.style.setProperty("--tekstskala", String(x));
          return el.scrollHeight <= el.clientHeight + 1;
        },
      });
      el.style.setProperty("--tekstskala", String(skala));
      el.classList.toggle("klipp", klipp);
    };
    tilpass();
    // Skriften lastes etter første maling; målingen med reserveskriften gir feil ordbredde.
    void document.fonts?.ready.then(tilpass);
    if (typeof ResizeObserver === "undefined") return;
    // Både bredde og høyde: feltet blir lavere når stripen nederst kommer til. Feltets
    // størrelse bestemmes av rutenettet, ikke av teksten, så målingen starter ikke seg selv.
    let bredde = el.clientWidth;
    let hoyde = el.clientHeight;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === bredde && el.clientHeight === hoyde) return;
      bredde = el.clientWidth;
      hoyde = el.clientHeight;
      tilpass();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [nokkel]);
  return ref;
}

/** Roterende indeks for en sone — står stille når det bare er én blokk. */
function useRotasjon(antall: number, sekunder: number): number {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (antall < 2) return;
    const t = window.setInterval(() => setI((x) => x + 1), sekunder * 1000);
    return () => window.clearInterval(t);
  }, [antall, sekunder]);
  return antall > 0 ? i % antall : 0;
}

function Sone({ navn, nokler, ctx, markert }: { navn: string; nokler: string[]; ctx: Kontekst; markert: boolean }) {
  const i = useRotasjon(nokler.length, SONE_SEKUNDER);
  const nokkel = ctx.visBlokk && nokler.includes(ctx.visBlokk) ? ctx.visBlokk : nokler[i];
  return (
    <div className={`ot-sone${markert ? " markert" : ""}`} style={{ gridArea: navn }}>
      {nokkel && (
        <div key={nokkel} className={nokler.length > 1 ? "ot-fade ot-sone-innhold" : "ot-sone-innhold"}>
          <Blokk nokkel={nokkel} ctx={ctx} />
        </div>
      )}
    </div>
  );
}

/** Stripen: alle blokkene side om side i kompakt form — ingen rotasjon, den er smal nok. */
function Stripe({ nokler, ctx, markert }: { nokler: string[]; ctx: Kontekst; markert: boolean }) {
  return (
    <div className={`ot-kort ot-stripe${markert ? " markert" : ""}`} style={{ gridArea: STRIPE }}>
      {nokler.map((n) => (
        <Blokk key={n} nokkel={n} ctx={ctx} kompakt />
      ))}
    </div>
  );
}

function Blokk({ nokkel, ctx, kompakt = false }: { nokkel: string; ctx: Kontekst; kompakt?: boolean }) {
  const { innhold } = ctx;
  if (nokkel === "oppslag") return <Oppslag ctx={ctx} />;
  if (nokkel === "kalender") return <Kalender ctx={ctx} kompakt={kompakt} />;
  if (nokkel === "kontakt") return <Kontakt ctx={ctx} kompakt={kompakt} />;
  if (nokkel === "tommedager") return <Tommedager avfall={innhold.avfall ?? []} naa={ctx.naa} kompakt={kompakt} />;
  const b = innhold.blokker?.[nokkel];
  if (b?.type === "vaer") return <Vaer b={b} kompakt={kompakt} />;
  if (b?.type === "avganger") return <Avganger b={b} naa={ctx.naa} kompakt={kompakt} />;
  return null;
}

// ---------------------------------------------------------------------------------------
// Blokkene
// ---------------------------------------------------------------------------------------

/** Om feltet oppslaget står i er stort nok til rutenett: minst 45 % av skjermens bredde og 40 % av høyden. */
function useStortFelt(nokkel: string) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [stort, setStort] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    const skjerm = el?.closest(".ot-skjerm");
    if (!el || !skjerm) return;
    const maal = () => setStort(el.clientWidth >= skjerm.clientWidth * 0.45 && el.clientHeight >= skjerm.clientHeight * 0.4);
    maal();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(maal);
    ro.observe(el);
    return () => ro.disconnect();
    // Elementet byttes når oppslaget byttes (`key`), så det må måles på nytt da.
  }, [nokkel]);
  return [ref, stort] as const;
}

function Oppslag({ ctx }: { ctx: Kontekst }) {
  // Et bildeoppslag er med i rotasjonen først når ALLE bildene er lastet — ellers blinker
  // det inn med grå flater. Forhåndsvisningen har alltid URL-er og slipper rett gjennom.
  const oppslag = ctx.innhold.oppslag.filter(
    (p) => p.type === "tekst" || ((p.sider?.length ?? 0) > 0 && p.sider!.every((s) => ctx.sideUrl(s.id))),
  );
  const [indeks, setIndeks] = useState(0);
  /** Bildet (eller rutenett-siden) som står nå. Tekst har bare «del» 0. */
  const [del, setDel] = useState(0);
  const aktivt = oppslag.length > 0 ? oppslag[indeks % oppslag.length]! : null;
  const [feltRef, stort] = useStortFelt(aktivt?.id ?? "");
  const sider = aktivt?.type === "bilder" ? (aktivt.sider ?? []) : [];
  // Rutenettet vises bare der feltet er stort nok; i små felt blas bildene gjennom.
  const rutenett = aktivt?.visning === "rutenett" && stort && !ctx.visSideId && sider.length > 1;
  const deler = Math.max(1, rutenett ? Math.ceil(sider.length / RUTENETT_ANTALL) : sider.length);
  // Hvert oppslag står i SIN tid — derfor en timeout per oppslag, ikke et fast intervall.
  // Et bildeoppslag bruker tiden per bilde og går videre til neste oppslag etter det siste.
  const sekunder = aktivt?.sekunder ?? STANDARD_SEKUNDER;
  const laast = ctx.laasOppslag;
  const valgtSide = ctx.visSideId ? sider.findIndex((s) => s.id === ctx.visSideId) : -1;
  useEffect(() => {
    const flereOppslag = oppslag.length > 1 && !laast;
    if (valgtSide >= 0 || (!flereOppslag && deler < 2)) return;
    const t = window.setTimeout(() => {
      if (del < deler - 1) return setDel(del + 1);
      setDel(0);
      if (flereOppslag) setIndeks((i) => i + 1);
    }, sekunder * 1000);
    return () => window.clearTimeout(t);
  }, [indeks, del, deler, sekunder, oppslag.length, laast, valgtSide]);
  // Forhåndsvisningen: styret klikket på en rad i lista, eller skriver på et utkast.
  const onsket = ctx.visOppslagId ? oppslag.findIndex((p) => p.id === ctx.visOppslagId) : -1;
  useEffect(() => {
    if (onsket < 0) return;
    setIndeks(onsket);
    setDel(0);
  }, [onsket, ctx.visOppslagId]);
  const tekstRef = useTilpassetTekst(aktivt ? `${aktivt.id}|${aktivt.tittel}|${aktivt.tekst ?? ""}|${aktivt.kategori}` : "");

  if (!aktivt) {
    return (
      <div className="ot-hero info" ref={feltRef}>
        <div className="ot-tag">Oppslag</div>
        <h3>Ingen oppslag nå</h3>
      </div>
    );
  }
  const prikker = oppslag.length > 1 && (
    <div className="ot-prikker">
      {oppslag.map((p, i) => (
        <i key={p.id} className={i === indeks % oppslag.length ? "pa" : ""} />
      ))}
    </div>
  );
  if (aktivt.type === "bilder") {
    const naa = valgtSide >= 0 ? valgtSide : Math.min(del, deler - 1);
    const bilde = (s: (typeof sider)[number]) => (
      <img
        src={ctx.sideUrl(s.id) ?? undefined}
        alt=""
        style={{ objectFit: s.tilpasning === "hele" ? "contain" : "cover", objectPosition: `${s.x}% ${s.y}%` }}
      />
    );
    return (
      <div key={aktivt.id} ref={feltRef} className="ot-hero ot-fade media">
        {rutenett ? (
          <div key={naa} className={`ot-siderutenett ot-fade n${Math.min(RUTENETT_ANTALL, sider.length - naa * RUTENETT_ANTALL)}`}>
            {sider.slice(naa * RUTENETT_ANTALL, (naa + 1) * RUTENETT_ANTALL).map((s) => (
              <figure key={s.id}>{bilde(s)}</figure>
            ))}
          </div>
        ) : (
          // Alle bildene ligger oppå hverandre; bare ett er synlig. Byttet blir da en myk
          // overgang, og neste bilde er ferdig dekodet før det vises.
          <div className="ot-sider">
            {sider.map((s, i) => (
              <figure key={s.id} className={i === naa ? "pa" : ""}>
                {bilde(s)}
                {s.tekst && <figcaption>{s.tekst}</figcaption>}
              </figure>
            ))}
          </div>
        )}
        {prikker}
      </div>
    );
  }
  return (
    <div
      key={aktivt.id}
      ref={(el) => {
        tekstRef.current = el;
        feltRef.current = el;
      }}
      className={`ot-hero ot-fade ${aktivt.kategori ?? "info"}`}
    >
      <div className="ot-tag">{KATEGORI_ETIKETT[aktivt.kategori ?? "info"]}</div>
      <h3>{aktivt.tittel}</h3>
      {aktivt.tekst && <p>{aktivt.tekst}</p>}
      {prikker}
    </div>
  );
}

function Kalender({ ctx, kompakt }: { ctx: Kontekst; kompakt: boolean }) {
  const hendelser = ctx.innhold.hendelser;
  if (kompakt) {
    const h = hendelser[0];
    return (
      <Kompakt tittel="Neste">
        {h ? (
          <span className="ot-kompakt-rad">
            <b>{kortDato(h.dato)}</b> {h.tittel}
            {h.tid && <span>kl. {h.tid}</span>}
          </span>
        ) : (
          <span className="ot-tom">Ingen hendelser</span>
        )}
      </Kompakt>
    );
  }
  return (
    <div className="ot-kort">
      <div className="ot-h">Kommer</div>
      {hendelser.length === 0 && <div className="ot-tom">Ingen kommende hendelser</div>}
      {hendelser.map((h) => {
        const d = new Date(`${h.dato}T12:00`);
        return (
          <div key={h.id} className="ot-hendelse">
            <div className="ot-dato">
              <b>{String(d.getDate()).padStart(2, "0")}</b>
              <span>{d.toLocaleDateString("nb-NO", { month: "short" }).replace(".", "")}</span>
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="x">{h.tittel}</div>
              <div className="y">{[h.tid && `Kl. ${h.tid}`, h.sted].filter(Boolean).join(", ")}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Kontakt({ ctx, kompakt }: { ctx: Kontekst; kompakt: boolean }) {
  const { org } = ctx.innhold;
  const kontakter = ctx.innhold.kontakter ?? [];
  const i = useRotasjon(kontakter.length, KONTAKT_SEKUNDER);
  const k = kontakter[i];

  if (kompakt) {
    return (
      <Kompakt tittel="Styret">
        <span className="ot-kompakt-rad">
          {k ? (
            <>
              <b>{k.navn}</b>
              <span>{k.telefon ?? k.epost}</span>
            </>
          ) : (
            <span>{org.telefon ?? org.epost ?? ""}</span>
          )}
        </span>
      </Kompakt>
    );
  }
  const bilde = k?.harBilde ? ctx.kontaktbildeUrl(k.id) : null;
  return (
    <div className="ot-kort ot-kontakt">
      <div className="ot-h">Kontakt styret</div>
      {k ? (
        <div key={k.id} className="ot-person ot-fade">
          {bilde && <img className="ot-portrett" src={bilde} alt="" />}
          <div style={{ minWidth: 0 }}>
            {/* Navn og rolle på hver sin linje — på samme linje kuttet ellipsen rollen først. */}
            <div className="ot-navn">{k.navn}</div>
            {k.rolle && <div className="ot-rolle">{k.rolle}</div>}
            {k.telefon && <div className="ot-ph">{k.telefon}</div>}
            {k.epost && <div className="ot-ph">{k.epost}</div>}
          </div>
        </div>
      ) : (
        <>
          {org.telefon && <div className="ot-ph">{org.telefon}</div>}
          {org.epost && <div className="ot-ph">{org.epost}</div>}
          {!org.telefon && !org.epost && <div className="ot-tom">Kontaktinfo er ikke lagt inn</div>}
        </>
      )}
      {/* Liggende prikker nederst, som i oppslagene. Stående streker til høyre så ut som en ødelagt QR-kode. */}
      {kontakter.length > 1 && (
        <div className="ot-prikker">
          {kontakter.map((x, j) => (
            <i key={x.id} className={j === i ? "pa" : ""} />
          ))}
        </div>
      )}
    </div>
  );
}

function Fraksjonsmerke({ fraksjon }: { fraksjon: string }) {
  const m = avfallMerke(fraksjon);
  const Ikon = IKONER[m.ikon] ?? Recycle;
  return (
    <span className="ot-merke-fraksjon" style={{ background: m.farge }} aria-hidden>
      <Ikon strokeWidth={2.2} />
    </span>
  );
}

function Tommedager({ avfall, naa, kompakt }: { avfall: NonNullable<Skjerminnhold["avfall"]>; naa: Date; kompakt: boolean }) {
  if (kompakt) {
    return (
      <Kompakt tittel="Tømming">
        {avfall.length === 0 && <span className="ot-tom">Ingen kjente datoer</span>}
        {avfall.map((a) => (
          <span key={a.fraksjon} className={`ot-kompakt-rad${dagerTil(a.dato, naa) <= 1 ? " snart" : ""}`}>
            <Fraksjonsmerke fraksjon={a.fraksjon} />
            {a.etikett}
            <span>{naarTomming(a.dato, naa)}</span>
          </span>
        ))}
      </Kompakt>
    );
  }
  return (
    <div className="ot-kort">
      <div className="ot-h">Tømmedager</div>
      {avfall.length === 0 && <div className="ot-tom">Ingen kjente tømmedager</div>}
      {avfall.map((a) => (
        <div key={a.fraksjon} className={`ot-tomrad${dagerTil(a.dato, naa) <= 1 ? " snart" : ""}`}>
          <Fraksjonsmerke fraksjon={a.fraksjon} />
          <span className="n">{a.etikett}</span>
          <span className="d">{naarTomming(a.dato, naa)}</span>
        </div>
      ))}
    </div>
  );
}

function Vaerikon({ symbol }: { symbol: string | null }) {
  const Ikon = IKONER[vaersymbol(symbol).ikon] ?? Cloud;
  return <Ikon className="ot-vaerikon" strokeWidth={1.8} aria-label={vaersymbol(symbol).tekst} />;
}

const grader = (t: number) => `${Math.round(t)}°`;

function Vaer({ b, kompakt }: { b: Extract<Blokkdata, { type: "vaer" }>; kompakt: boolean }) {
  const v = b.varsel!;
  const timer = v.timer.filter((_, i) => i % 2 === 1).slice(0, 6);
  if (kompakt) {
    return (
      <Kompakt tittel={b.sted}>
        <span className="ot-kompakt-rad">
          <Vaerikon symbol={v.naa.symbol} />
          <b>{grader(v.naa.temp)}</b>
        </span>
        {(b.visning === "dager" ? v.dager.slice(0, 3) : timer.slice(0, 3)).map((x) => (
          <span key={"dato" in x ? x.dato : x.tid} className="ot-kompakt-rad">
            <span>{"dato" in x ? ukedag(x.dato) : time(x.tid)}</span>
            <Vaerikon symbol={x.symbol} />
            {"dato" in x ? `${grader(x.maks)}/${grader(x.min)}` : grader(x.temp)}
          </span>
        ))}
      </Kompakt>
    );
  }
  return (
    <div className="ot-kort ot-vaer">
      <div className="ot-h">Været · {b.sted}</div>
      <div className="ot-vaer-naa">
        <Vaerikon symbol={v.naa.symbol} />
        <b>{grader(v.naa.temp)}</b>
        <span>{vaersymbol(v.naa.symbol).tekst}</span>
      </div>
      <div className="ot-vaer-rekke">
        {b.visning === "dager"
          ? v.dager.map((d) => (
              <div key={d.dato}>
                <span>{ukedag(d.dato)}</span>
                <Vaerikon symbol={d.symbol} />
                <b>{grader(d.maks)}</b>
                <span>{grader(d.min)}</span>
              </div>
            ))
          : timer.map((t) => (
              <div key={t.tid}>
                <span>{time(t.tid)}</span>
                <Vaerikon symbol={t.symbol} />
                <b>{grader(t.temp)}</b>
                <span>{t.nedbor ? `${t.nedbor} mm` : " "}</span>
              </div>
            ))}
      </div>
      <div className="ot-kilde">Værdata fra MET Norway</div>
    </div>
  );
}

function Linjemerke({ a }: { a: { linje: string; modus: string } }) {
  const Ikon = IKONER[transportmiddel(a.modus).ikon] ?? Bus;
  return (
    <span className={`ot-linje ${a.modus}`}>
      <Ikon strokeWidth={2.2} aria-label={transportmiddel(a.modus).tekst} />
      {a.linje}
    </span>
  );
}

function Avganger({ b, naa, kompakt }: { b: Extract<Blokkdata, { type: "avganger" }>; naa: Date; kompakt: boolean }) {
  if (kompakt) {
    const h = b.holdeplasser[0];
    return (
      <Kompakt tittel={h?.navn ?? b.navn}>
        {(h?.avganger ?? []).slice(0, 3).map((a, i) => (
          <span key={i} className={`ot-kompakt-rad${a.innstilt ? " innstilt" : ""}`}>
            <Linjemerke a={a} />
            <b>{avgangstid(a.tid, naa)}</b>
          </span>
        ))}
      </Kompakt>
    );
  }
  return (
    <div className="ot-kort ot-avganger">
      {b.holdeplasser.map((h) => (
        <div key={h.navn} className="ot-holdeplass">
          <div className="ot-h">{h.navn}</div>
          {h.avganger.length === 0 && <div className="ot-tom">Ingen avganger de neste to timene</div>}
          {h.avganger.map((a, i) => (
            <div key={i} className={`ot-avgang${a.innstilt ? " innstilt" : ""}`}>
              <Linjemerke a={a} />
              <span className="mot">{a.mot}</span>
              <span className={`tid${a.sanntid ? " sanntid" : ""}`}>{a.innstilt ? "Innstilt" : avgangstid(a.tid, naa)}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Kompakt({ tittel, children }: { tittel: string; children: ReactNode }) {
  return (
    <div className="ot-kompakt">
      <span className="ot-h">{tittel}</span>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// Ramme
// ---------------------------------------------------------------------------------------

/** Bildet før skjermen er koblet til et borettslag. */
export function Koblingsskjerm({ kode, gyldigTil }: { kode: string | null; gyldigTil: string | null }) {
  const naa = useKlokke();
  const igjen = gyldigTil ? Math.max(0, Math.floor((new Date(gyldigTil).getTime() - naa.getTime()) / 1000)) : null;
  return (
    <div className="ot-skjerm liggende" style={skjermpalett("#0b1f3a", "#4c9bff") as CSSProperties}>
      <div className="ot-midt">
        <div className="ot-logo">IQ</div>
        <div className="ot-lbl">DriftIQ Oppslagstavle</div>
        <p>Denne skjermen er ikke koblet til et borettslag ennå.</p>
        <div>
          <div className="ot-lbl">Koblingskode</div>
          <div className="ot-kode">{kode ? visKode(kode) : "…"}</div>
        </div>
        <p>
          Logg inn i DriftIQ, gå til Oppslagstavle og velg <b>Koble til skjerm</b>.
        </p>
      </div>
      <Fot
        tekst={igjen !== null ? `Koden fornyes om ${Math.floor(igjen / 60)}:${String(igjen % 60).padStart(2, "0")}` : ""}
      />
    </div>
  );
}

function Topp({ innhold, naa, logoUrl }: { innhold: Skjerminnhold; naa: Date; logoUrl: string | null }) {
  return (
    <div className="ot-topp">
      <div className="ot-id">
        <div className="ot-logo">{logoUrl ? <img src={logoUrl} alt="" /> : innhold.org.initialer}</div>
        <div className="ot-adr">
          {innhold.org.navn}
          <b>{innhold.skjerm.adresse || innhold.skjerm.navn}</b>
        </div>
      </div>
      <div className="ot-klokke">
        <div className="c">{klokke(naa)}</div>
        <div className="d">{naa.toLocaleDateString("nb-NO", { weekday: "long", day: "numeric", month: "long" })}</div>
      </div>
    </div>
  );
}

function Fot({ tekst }: { tekst: string }) {
  return (
    <div className="ot-fot">
      <span>{tekst}</span>
      <span className="ot-merke">
        <i>IQ</i>Drevet av DriftIQ
      </span>
    </div>
  );
}

/** Ikonene tavla bruker, slått opp på navn — navnene kommer fra de importfrie regelfilene. */
const IKONER: Record<string, LucideIcon> = {
  Apple, Bus, Cloud, CloudDrizzle, CloudFog, CloudHail, CloudLightning, CloudMoon, CloudMoonRain,
  CloudRain, CloudRainWind, CloudSnow, CloudSun, CloudSunRain, Moon, Newspaper, Plane, Recycle,
  Ship, Sun, TrainFront, TramFront, Trash2, Wine,
};

/** Hele dager fra i dag (lokal dato på skjermen) til ÅÅÅÅ-MM-DD. */
function dagerTil(dato: string, naa: Date): number {
  const idag = new Date(naa.getFullYear(), naa.getMonth(), naa.getDate()).getTime();
  const [a, m, d] = dato.split("-").map(Number);
  return Math.round((new Date(a!, m! - 1, d!).getTime() - idag) / 86_400_000);
}

/** «i dag», «i morgen», ellers «man. 5. okt.» — det beboeren trenger i forbifarten. */
function naarTomming(dato: string, naa: Date): string {
  const n = dagerTil(dato, naa);
  if (n === 0) return "i dag";
  if (n === 1) return "i morgen";
  return new Date(`${dato}T12:00`).toLocaleDateString("nb-NO", { weekday: "short", day: "numeric", month: "short" });
}

const kortDato = (dato: string) =>
  new Date(`${dato}T12:00`).toLocaleDateString("nb-NO", { day: "numeric", month: "short" });
const ukedag = (dato: string) => new Date(`${dato}T12:00`).toLocaleDateString("nb-NO", { weekday: "short" });
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("nb-NO", { hour: "2-digit", timeZone: "Europe/Oslo" });

function klokke(d: Date): string {
  return d.toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" });
}

function useKlokke(): Date {
  const [naa, setNaa] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNaa(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);
  return naa;
}
