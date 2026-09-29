"use client";

import type { CSSProperties } from "react";
import { Felt as Skjemafelt } from "@/components/skjema";
import type { Retning } from "@/lib/oppslagstavleregler";
import { SONE_NAVN, STRIPE, finnMal, malerFor, type Mal } from "@/lib/tavlemaler";

/**
 * Mal og soner for én skjerm. Styret velger malen (miniatyrene viser inndelingen) og krysser
 * av hvilke blokker som skal stå i hver sone. Flere blokker i samme sone roterer, i den
 * rekkefølgen de ble valgt — tallet på merket viser rekkefølgen.
 */
export function SoneOppsett({
  retning,
  malId,
  soner,
  blokker,
  onEndre,
}: {
  retning: Retning;
  malId: string;
  soner: Record<string, string[]>;
  /** Blokkene som kan plasseres: nøkkel + navn. */
  blokker: ReadonlyArray<{ nokkel: string; navn: string; merknad?: string }>;
  onEndre: (malId: string, soner: Record<string, string[]>) => void;
}) {
  const mal = finnMal(malId, retning);

  function velgMal(ny: Mal) {
    // Soner med samme navn beholder innholdet; nye soner får malens standard.
    const s: Record<string, string[]> = {};
    for (const sone of [...ny.soner, STRIPE]) s[sone] = soner[sone] ?? ny.standard[sone] ?? [];
    onEndre(ny.id, s);
  }

  function veksle(sone: string, nokkel: string) {
    const liste = soner[sone] ?? [];
    onEndre(mal.id, {
      ...soner,
      [sone]: liste.includes(nokkel) ? liste.filter((n) => n !== nokkel) : [...liste, nokkel],
    });
  }

  return (
    <>
      <Skjemafelt etikett="Mal" notat="Hvordan skjermen deles opp. Stripen nederst tar bare plassen innholdet trenger.">
        <div className="ot-maler">
          {malerFor(retning).map((m) => (
            <button
              type="button"
              key={m.id}
              className={`ot-mal${m.id === mal.id ? " valgt" : ""}`}
              onClick={() => velgMal(m)}
            >
              <Miniatyr mal={m} liggende={retning === "liggende"} />
              <span>{m.navn}</span>
            </button>
          ))}
        </div>
      </Skjemafelt>

      {[...mal.soner, STRIPE].map((sone) => {
        const valgte = soner[sone] ?? [];
        return (
          <Skjemafelt
            key={sone}
            etikett={`${SONE_NAVN[sone] ?? sone}${sone !== STRIPE ? ` (${sone.toUpperCase()})` : ""}`}
            notat={valgte.length > 1 ? "Blokkene roterer i rekkefølgen tallene viser." : undefined}
          >
            <div className="ot-filter">
              {blokker.map((b) => {
                const plass = valgte.indexOf(b.nokkel);
                return (
                  <button
                    type="button"
                    key={b.nokkel}
                    title={b.merknad}
                    className={`ot-chip${plass >= 0 ? " valgt" : ""}`}
                    onClick={() => veksle(sone, b.nokkel)}
                  >
                    {plass >= 0 && valgte.length > 1 && <b>{plass + 1}. </b>}
                    {b.navn}
                  </button>
                );
              })}
            </div>
          </Skjemafelt>
        );
      })}
    </>
  );
}

/** Malens inndeling i miniatyr — samme grid-oppsett som skjermen, med sonebokstavene. */
function Miniatyr({ mal, liggende }: { mal: Mal; liggende: boolean }) {
  const bredde = mal.omrader[0]!.split(" ").length;
  const stil: CSSProperties = {
    gridTemplateColumns: mal.kolonner,
    gridTemplateRows: `${mal.rader} 0.25fr`,
    gridTemplateAreas: [...mal.omrader, Array(bredde).fill(STRIPE).join(" ")].map((r) => `'${r}'`).join(" "),
    aspectRatio: liggende ? "16 / 9" : "9 / 16",
    // Stående: høyden styrer, ellers blir miniatyren en meter lang i en smal kolonne.
    ...(liggende ? { width: "100%" } : { height: "90px", width: "auto" }),
  };
  return (
    <span className="ot-miniatyr" style={stil} aria-hidden>
      {[...mal.soner, STRIPE].map((s) => (
        <i key={s} style={{ gridArea: s }}>
          {s === STRIPE ? "" : s.toUpperCase()}
        </i>
      ))}
    </span>
  );
}
