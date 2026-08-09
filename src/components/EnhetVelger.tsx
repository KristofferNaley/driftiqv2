"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { enhetNavn, enhetTreffer, type Enhetsnavn } from "@/lib/enhetnavn";

export type VelgbarEnhet = Enhetsnavn & { id: string };

/**
 * Nedtrekk med søkefelt for enheter. Port av v1s `LeilighetVelger`.
 *
 * En vanlig `<select>` med 84 rader er ubrukelig i praksis: man kan bare hoppe med
 * førstebokstav, og alle radene begynner på «H». Her skriver man «305» og får H0305.
 *
 * Åpen/lukket-tilstanden ligger her, ikke hos kallstedet — tre steder i Avvik bruker den,
 * og ingen av dem har noe å bruke tilstanden til.
 */
export default function EnhetVelger({
  verdi,
  onEndre,
  enheter,
  tomEtikett,
  ariaEtikett,
}: {
  verdi: string;
  onEndre: (id: string) => void;
  enheter: VelgbarEnhet[];
  tomEtikett: string;
  ariaEtikett: string;
}) {
  const [apen, setApen] = useState(false);
  const [opp, setOpp] = useState(false);
  const [sok, setSok] = useState("");
  const rammeRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const feltRef = useRef<HTMLInputElement>(null);

  const valgt = enheter.find((u) => u.id === verdi);
  const treff = sok.trim() ? enheter.filter((u) => enhetTreffer(u, sok)) : enheter;
  // Fellesarealene øverst: lista er kort, og «lyspære i bossrommet» er et vel så vanlig
  // avvik som noe i en bestemt leilighet. Gruppeoverskrifter vises bare når begge finnes.
  const felles = treff.filter((u) => u.type === "fellesareal");
  const boliger = treff.filter((u) => u.type !== "fellesareal");

  // Lukk ved klikk utenfor og ved Escape. Uten dette blir panelet stående åpent over
  // resten av skjemaet så snart man ombestemmer seg.
  useEffect(() => {
    if (!apen) return;
    const utenfor = (e: MouseEvent) => {
      if (rammeRef.current && !rammeRef.current.contains(e.target as Node)) setApen(false);
    };
    const tast = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setApen(false);
        setSok("");
      }
    };
    document.addEventListener("mousedown", utenfor);
    document.addEventListener("keydown", tast);
    return () => {
      document.removeEventListener("mousedown", utenfor);
      document.removeEventListener("keydown", tast);
    };
  }, [apen]);

  useEffect(() => {
    if (apen) feltRef.current?.focus();
  }, [apen]);

  // Meldeskjemaet er en modal med `overflow: auto`, så et panel som stikker nedenfor
  // modalkanten blir klippet — man ser en halv liste og skjønner ikke at resten finnes.
  // Vend oppover når det er trangt under og bedre plass over.
  useLayoutEffect(() => {
    if (!apen) {
      setOpp(false);
      return;
    }
    const knapp = rammeRef.current?.firstElementChild;
    const panel = panelRef.current;
    if (!knapp || !panel) return;
    const r = knapp.getBoundingClientRect();
    const h = panel.offsetHeight;
    setOpp(window.innerHeight - r.bottom < h + 8 && r.top > h + 8);
  }, [apen]);

  // Og scroll det siste stykket fram uansett retning — flippen alene hjelper ikke når
  // panelet er klippet av en scrollboks som er kortere enn vinduet.
  useEffect(() => {
    if (apen) panelRef.current?.scrollIntoView({ block: "nearest" });
  }, [apen, opp]);

  function velg(id: string) {
    onEndre(id);
    setApen(false);
    setSok("");
  }

  return (
    <div className="enhet-velger" ref={rammeRef}>
      <button
        type="button"
        className="enhet-knapp"
        aria-haspopup="listbox"
        aria-expanded={apen}
        aria-label={ariaEtikett}
        onClick={() => setApen((v) => !v)}
      >
        <span className={valgt ? undefined : "tom"}>{valgt ? enhetNavn(valgt) : tomEtikett}</span>
        <span className="pil" aria-hidden>
          ▾
        </span>
      </button>

      {apen && (
        <div className={`enhet-panel${opp ? " opp" : ""}`} ref={panelRef}>
          <input
            ref={feltRef}
            className="input enhet-sok"
            placeholder="Søk, f.eks. 305 eller bossrom …"
            value={sok}
            onChange={(e) => setSok(e.target.value)}
            // Enter velger øverste treff — den vanligste handlingen når man alt har skrevet
            // nok til at det står én igjen.
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (treff.length) velg(treff[0]!.id);
              }
            }}
          />
          <div className="enhet-liste" role="listbox">
            <button
              type="button"
              className={`enhet-opt${!verdi ? " valgt" : ""}`}
              onClick={() => velg("")}
            >
              {tomEtikett}
            </button>
            {([
              [felles, "Fellesareal"],
              [boliger, "Leiligheter"],
            ] as const).map(
              ([gruppe, tittel]) =>
                gruppe.length > 0 && (
                  <div key={tittel}>
                    {felles.length > 0 && boliger.length > 0 && (
                      <div className="enhet-gruppe">{tittel}</div>
                    )}
                    {gruppe.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        role="option"
                        aria-selected={u.id === verdi}
                        className={`enhet-opt${u.id === verdi ? " valgt" : ""}`}
                        onClick={() => velg(u.id)}
                      >
                        <span>{enhetNavn(u)}</span>
                        {/* Andelsnummeret er søkbart, men står dempet til høyre så det ikke
                            konkurrerer med H-nummeret om oppmerksomheten. */}
                        {u.andelsnr && u.leilighetsnr && (
                          <span className="meta">Andel {u.andelsnr}</span>
                        )}
                      </button>
                    ))}
                  </div>
                ),
            )}
            {treff.length === 0 && <div className="enhet-tomt">Ingen treff på «{sok.trim()}».</div>}
          </div>
        </div>
      )}
    </div>
  );
}
