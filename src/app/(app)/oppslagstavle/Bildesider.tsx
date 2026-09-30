"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { ArrowLeft, ArrowRight, Upload, X } from "lucide-react";
import { Feil } from "@/components/felles";
import { Avkryssing, Felt as Skjemafelt } from "@/components/skjema";
import { oppslagstavle, type Tavleside } from "@/lib/klient";
import { MAKS_BILDETEKST, MAKS_SIDER, OPPLASTING_ACCEPT, filFeil } from "@/lib/oppslagstavleregler";

/**
 * Sidene i et bildeoppslag: opplasting (dra og slipp eller «Legg til filer»), miniatyrer som
 * kan dras i rekkefølge og fjernes, og ett bilde stort med fokuspunkt og bildetekst.
 *
 * Alt her lagres STRAKS — filer, rekkefølge, bildetekst og fokuspunkt — i motsetning til
 * resten av skjemaet, som venter på «Legg ut»/«Lagre». For et nytt oppslag er det en kladd
 * som tar imot filene (`sikrePost`); «Avbryt» sletter den.
 *
 * «Fjern» sletter ikke med en gang: bildet skjules, og slettingen sendes etter fem sekunder
 * hvis ingen angrer. `fullforRef` lar skjemaet sende den før det lagrer eller lukker.
 */

const ANGRE_MS = 5000;

type Ko = { nokkel: number; navn: string; andel: number; feil: string | null };

export function Bildesider({
  orgId,
  postId,
  sikrePost,
  start,
  valgt,
  onVelg,
  onEndret,
  fullforRef,
}: {
  orgId: string;
  postId: string | null;
  /** Id-en til oppslaget filene skal inn i. Oppretter kladden første gang for et nytt oppslag. */
  sikrePost: () => Promise<string>;
  start: Tavleside[];
  /** Bildet som er åpent stort, eller `null` for rutenettet med miniatyrer. */
  valgt: string | null;
  onVelg: (id: string | null) => void;
  /** Sidene slik de står nå — uten den som venter på å bli fjernet. */
  onEndret: (sider: Tavleside[]) => void;
  fullforRef: MutableRefObject<(() => Promise<void>) | null>;
}) {
  const [raa, setRaa] = useState(start);
  const [fjernes, setFjernes] = useState<Tavleside | null>(null);
  const [ko, setKo] = useState<Ko[]>([]);
  const [feil, setFeil] = useState<string | null>(null);
  const [slipper, setSlipper] = useState(false);
  const [drar, setDrar] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const tidtaker = useRef<number | null>(null);
  const nesteNokkel = useRef(0);
  const filvelger = useRef<HTMLInputElement | null>(null);

  const sider = raa.filter((s) => s.id !== fjernes?.id);
  useEffect(() => {
    onEndret(sider);
    // `onEndret` er en stabil setter hos forelderen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raa, fjernes]);

  const melde = (e: unknown) => setFeil(e instanceof Error ? e.message : "Noe gikk galt");

  // --- Fjerning med angrefrist --------------------------------------------------------
  async function fullfor() {
    if (tidtaker.current !== null) window.clearTimeout(tidtaker.current);
    tidtaker.current = null;
    const side = fjernes;
    if (!side || !postId) return;
    setFjernes(null);
    setRaa((r) => r.filter((s) => s.id !== side.id));
    await oppslagstavle.slettSide(orgId, postId, side.id).catch(() => {
      // Oppslaget kan være slettet i mellomtiden (kladd som ble avbrutt) — da er bildet borte uansett.
    });
  }
  fullforRef.current = fullfor;
  // Lukkes panelet mens et bilde venter på å bli fjernet, sendes slettingen likevel.
  useEffect(() => () => void fullforRef.current?.(), [fullforRef]);

  async function fjern(side: Tavleside) {
    await fullfor();
    if (valgt === side.id) onVelg(null);
    setFjernes(side);
    tidtaker.current = window.setTimeout(() => void fullforRef.current?.(), ANGRE_MS);
  }
  function angre() {
    if (tidtaker.current !== null) window.clearTimeout(tidtaker.current);
    tidtaker.current = null;
    setFjernes(null);
  }

  // --- Opplasting ---------------------------------------------------------------------
  /** Én og én fil, i den rekkefølgen de ble valgt. En fil som feiler, stopper ikke de neste. */
  async function leggTil(filer: File[]) {
    setFeil(null);
    const nye = filer.map((fil) => ({ fil, rad: { nokkel: nesteNokkel.current++, navn: fil.name, andel: 0, feil: filFeil(fil) } }));
    setKo((k) => [...k.filter((x) => x.feil === null), ...nye.map((n) => n.rad)]);
    const sett = (nokkel: number, e: Partial<Ko>) => setKo((k) => k.map((x) => (x.nokkel === nokkel ? { ...x, ...e } : x)));
    for (const { fil, rad } of nye) {
      if (rad.feil) continue;
      try {
        const id = await sikrePost();
        setRaa(await oppslagstavle.lastOppSide(orgId, id, fil, (andel) => sett(rad.nokkel, { andel })));
        setKo((k) => k.filter((x) => x.nokkel !== rad.nokkel));
      } catch (e) {
        sett(rad.nokkel, { feil: e instanceof Error ? e.message : "Opplastingen feilet" });
      }
    }
  }

  // --- Rekkefølge ---------------------------------------------------------------------
  async function slipp(maal: string) {
    const fra = sider.findIndex((s) => s.id === drar);
    const til = sider.findIndex((s) => s.id === maal);
    setDrar(null);
    setOver(null);
    if (!postId || fra < 0 || til < 0 || fra === til) return;
    const ny = [...sider];
    ny.splice(til, 0, ny.splice(fra, 1)[0]!);
    await fullfor();
    setRaa(ny);
    oppslagstavle.settSiderekkefolge(orgId, postId, ny.map((s) => s.id)).then(setRaa).catch(melde);
  }

  // --- Ett bilde stort ----------------------------------------------------------------
  const i = sider.findIndex((s) => s.id === valgt);
  const side = i >= 0 ? sider[i]! : null;
  const lokalt = (s: Tavleside) => setRaa((r) => r.map((x) => (x.id === s.id ? s : x)));
  const lagre = (s: Tavleside) => {
    lokalt(s);
    if (postId) oppslagstavle.endreSide(orgId, postId, s).catch(melde);
  };

  if (side) {
    return (
      <div className="ot-bildestor">
        <div className="ot-bildestor-topp">
          <button type="button" className="ot-lenke" onClick={() => onVelg(null)}>
            Tilbake til bildene
          </button>
          <span className="field-note">
            Bilde {i + 1} av {sider.length}
          </span>
        </div>
        <div className="ot-bildestor-ramme">
          <div className="ot-fokus">
            <img
              src={oppslagstavle.sideSti(orgId, side.id)}
              alt={side.tekst ?? `Bilde ${i + 1}`}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                const pst = (v: number) => Math.max(0, Math.min(100, Math.round(v * 100)));
                lagre({ ...side, x: pst((e.clientX - r.left) / r.width), y: pst((e.clientY - r.top) / r.height) });
              }}
            />
            {side.tilpasning === "dekk" && <i style={{ left: `${side.x}%`, top: `${side.y}%` }} aria-hidden />}
          </div>
        </div>
        <div className="field-note">
          {side.tilpasning === "dekk"
            ? "Klikk i bildet for å sette fokuspunktet. Det er den delen som alltid er synlig når bildet beskjæres for å fylle feltet."
            : "Hele bildet vises, med luft rundt der feltet har en annen form."}
        </div>
        <Avkryssing
          etikett="Vis hele bildet uten beskjæring"
          verdi={side.tilpasning === "hele"}
          onEndre={(v) => lagre({ ...side, tilpasning: v ? "hele" : "dekk" })}
          notat="Passer for lysbilder og plakater med tekst helt ut i kanten."
        />
        <Skjemafelt etikett="Bildetekst (valgfri)">
          <input
            className="input"
            value={side.tekst ?? ""}
            maxLength={MAKS_BILDETEKST}
            placeholder="F.eks. Dugnaden i april"
            onChange={(e) => lokalt({ ...side, tekst: e.target.value || null })}
            onBlur={() => lagre(side)}
          />
          <div className="ot-tekstnotat">
            <span />
            <span className="ot-teller">
              {(side.tekst ?? "").length}/{MAKS_BILDETEKST}
            </span>
          </div>
        </Skjemafelt>
        <div className="ot-bildestor-topp">
          <button type="button" className="btn btn-ghost" disabled={i === 0} onClick={() => onVelg(sider[i - 1]!.id)}>
            <ArrowLeft size={14} aria-hidden /> Forrige
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => void fjern(side)}>
            Fjern
          </button>
          <button type="button" className="btn btn-ghost" disabled={i === sider.length - 1} onClick={() => onVelg(sider[i + 1]!.id)}>
            Neste <ArrowRight size={14} aria-hidden />
          </button>
        </div>
        <Feil melding={feil} />
      </div>
    );
  }

  const fullt = sider.length >= MAKS_SIDER;
  return (
    <div className="ot-bildesider">
      <div
        className={`ot-slipp${slipper ? " over" : ""}`}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setSlipper(true);
        }}
        onDragLeave={() => setSlipper(false)}
        onDrop={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setSlipper(false);
          void leggTil([...e.dataTransfer.files]);
        }}
      >
        <Upload size={18} aria-hidden />
        <div>
          <b>Dra filer hit</b>, eller
        </div>
        <button type="button" className="btn btn-ghost" disabled={fullt} onClick={() => filvelger.current?.click()}>
          Legg til filer
        </button>
        <input
          ref={filvelger}
          type="file"
          multiple
          hidden
          accept={OPPLASTING_ACCEPT}
          onChange={(e) => {
            void leggTil([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
        <div className="field-note">
          JPG, PNG, WebP, HEIC eller PDF. Maks 20 MB per fil og {MAKS_SIDER} bilder per oppslag. Hver side i en PDF blir ett
          bilde.
        </div>
      </div>

      {ko.map((k) => (
        <div key={k.nokkel} className={`ot-ko${k.feil ? " feil" : ""}`}>
          <div className="ot-ko-linje">
            <span className="ot-ko-navn">{k.navn}</span>
            {k.feil ? (
              <>
                <span className="ot-ko-status">{k.feil}</span>
                <button
                  type="button"
                  className="ot-ko-lukk"
                  aria-label={`Skjul ${k.navn}`}
                  onClick={() => setKo((x) => x.filter((y) => y.nokkel !== k.nokkel))}
                >
                  <X size={13} aria-hidden />
                </button>
              </>
            ) : (
              <span className="ot-ko-status">{k.andel >= 1 ? "Behandler …" : `${Math.round(k.andel * 100)} %`}</span>
            )}
          </div>
          {!k.feil && (
            <div className="ot-ko-stolpe" role="progressbar" aria-valuenow={Math.round(k.andel * 100)} aria-valuemin={0} aria-valuemax={100}>
              <i style={{ width: `${Math.round(k.andel * 100)}%` }} />
            </div>
          )}
        </div>
      ))}

      {fjernes && (
        <div className="ot-angre" role="status">
          Bildet er fjernet.
          <button type="button" className="ot-lenke" onClick={angre}>
            Angre
          </button>
        </div>
      )}

      {sider.length > 0 && (
        <div className="ot-miniatyrer">
          {sider.map((s, n) => (
            <div
              key={s.id}
              className={`ot-mini${drar === s.id ? " dras" : ""}${over === s.id && drar !== s.id ? " over" : ""}`}
              draggable={sider.length > 1}
              onDragStart={(e) => {
                setDrar(s.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                if (!drar) return;
                e.preventDefault();
                e.stopPropagation();
                setOver(s.id);
              }}
              onDrop={(e) => {
                if (!drar) return;
                e.preventDefault();
                e.stopPropagation();
                void slipp(s.id);
              }}
              onDragEnd={() => {
                setDrar(null);
                setOver(null);
              }}
            >
              <button type="button" className="ot-mini-bilde" aria-label={`Åpne bilde ${n + 1}`} onClick={() => onVelg(s.id)}>
                <img
                  src={oppslagstavle.sideSti(orgId, s.id)}
                  alt=""
                  draggable={false}
                  style={{ objectFit: s.tilpasning === "hele" ? "contain" : "cover", objectPosition: `${s.x}% ${s.y}%` }}
                />
                <span className="ot-mini-nr">{n + 1}</span>
              </button>
              <button type="button" className="ot-mini-fjern" onClick={() => void fjern(s)}>
                Fjern
              </button>
            </div>
          ))}
        </div>
      )}
      {sider.length > 1 && <div className="field-note">Dra bildene for å endre rekkefølgen. Klikk på et bilde for fokuspunkt og bildetekst.</div>}
      <Feil melding={feil} />
    </div>
  );
}
