"use client";

import { type CSSProperties } from "react";
import { AlertTriangle, Plus } from "lucide-react";
import { Felt as Skjemafelt } from "@/components/skjema";
import type { BirStatus, Tavleblokk } from "@/lib/klient";
import type { Retning } from "@/lib/oppslagstavleregler";
import {
  INNEBYGD_NAVN,
  STRIPE,
  feltI,
  feltNavn,
  malerFor,
  type Felt,
  type InnebygdBlokk,
  type Mal,
} from "@/lib/tavlemaler";
import { blokkNavn, manglerOppsett } from "./felles";

/**
 * Mal og felt per skjerm. Malen deler skjermen i felt; kartet viser feltene, og et klikk på
 * et felt åpner velgeren for hva som skal stå der. Se docs/oppslagstavle.md.
 */

function rutenett(mal: Mal, stripe: string): CSSProperties {
  const bredde = mal.omrader[0]!.split(" ").length;
  return {
    gridTemplateColumns: mal.kolonner,
    gridTemplateRows: `${mal.rader} ${stripe}`,
    gridTemplateAreas: [...mal.omrader, Array(bredde).fill(STRIPE).join(" ")].map((r) => `'${r}'`).join(" "),
  };
}

export function MalVelger({
  retning,
  malId,
  onEndre,
  laast,
}: {
  retning: Retning;
  malId: string;
  onEndre: (malId: string) => void;
  laast?: boolean;
}) {
  return (
    <Skjemafelt etikett="Mal" notat="Hvordan skjermen deles opp. Felt som finnes i både gammel og ny mal, beholder innholdet.">
      <div className="ot-maler">
        {malerFor(retning).map((m) => (
          <button
            type="button"
            key={m.id}
            disabled={laast}
            className={`ot-mal${m.id === malId ? " valgt" : ""}`}
            onClick={() => onEndre(m.id)}
          >
            <Miniatyr mal={m} liggende={retning === "liggende"} />
            <span>{m.navn}</span>
          </button>
        ))}
      </div>
    </Skjemafelt>
  );
}

/** Malens inndeling i miniatyr: det store feltet mørkere, de andre lysere, stripen nederst. */
function Miniatyr({ mal, liggende }: { mal: Mal; liggende: boolean }) {
  const stil: CSSProperties = {
    ...rutenett(mal, "0.25fr"),
    aspectRatio: liggende ? "16 / 9" : "9 / 16",
    // Stående: høyden styrer, ellers blir miniatyren en meter lang i en smal kolonne.
    ...(liggende ? { width: "100%" } : { height: "90px", width: "auto" }),
  };
  return (
    <span className="ot-miniatyr" style={stil} aria-hidden>
      {feltI(mal).map((s) => (
        <i key={s} style={{ gridArea: s }} className={s === "a" ? "hoved" : ""} />
      ))}
    </span>
  );
}

/** Kartet over feltene. Et tomt felt står som «Velg innhold», så det ikke kan overses. */
export function Feltkart({
  mal,
  felt,
  valgt,
  onVelg,
  blokker,
  bir,
}: {
  mal: Mal;
  felt: Felt;
  valgt: string | null;
  onVelg: (felt: string) => void;
  blokker: Tavleblokk[];
  bir: BirStatus;
}) {
  const liggende = mal.retning === "liggende";
  return (
    <div className={`ot-kart${liggende ? " liggende" : ""}`} style={rutenett(mal, "minmax(44px, 0.3fr)")}>
      {feltI(mal).map((f) => {
        const nokler = felt[f] ?? [];
        const erStripe = f === STRIPE;
        const mangler = nokler.some((n) => manglerOppsett(n, blokker, bir));
        return (
          <button
            type="button"
            key={f}
            style={{ gridArea: f }}
            className={`ot-felt${valgt === f ? " valgt" : ""}${nokler.length === 0 && !erStripe ? " tomt" : ""}`}
            aria-pressed={valgt === f}
            onClick={() => onVelg(f)}
          >
            <span className="ot-felt-navn">{feltNavn(mal, f)}</span>
            {nokler.length === 0 ? (
              <b>{erStripe ? "Ingenting" : "Velg innhold"}</b>
            ) : (
              <b>
                {mangler && <AlertTriangle size={13} aria-label="Mangler oppsett" />}
                {nokler.map((n) => blokkNavn(n, blokker)).join(", ")}
              </b>
            )}
          </button>
        );
      })}
    </div>
  );
}

const FASTE: InnebygdBlokk[] = ["oppslag", "kalender", "tommedager", "kontakt"];

/** Velgeren for ett felt: hvilke innholdstyper som står der. Flere valg roterer. */
export function Feltvelger({
  mal,
  felt,
  valgt,
  onEndre,
  blokker,
  bir,
  laast,
  kanLageBlokk,
  onNyBlokk,
}: {
  mal: Mal;
  felt: Felt;
  valgt: string;
  onEndre: (nokler: string[]) => void;
  blokker: Tavleblokk[];
  bir: BirStatus;
  /** Bare orgadmin endrer feltene; andre ser hva som står der. */
  laast: boolean;
  kanLageBlokk: boolean;
  onNyBlokk: (type: "vaer" | "avganger") => void;
}) {
  const nokler = felt[valgt] ?? [];
  const veksle = (n: string) => onEndre(nokler.includes(n) ? nokler.filter((x) => x !== n) : [...nokler, n]);
  const chip = (n: string, navn: string) => (
    <button
      type="button"
      key={n}
      disabled={laast}
      className={`ot-chip${nokler.includes(n) ? " valgt" : ""}`}
      aria-pressed={nokler.includes(n)}
      onClick={() => veksle(n)}
    >
      {navn}
    </button>
  );
  const mangler = nokler.map((n) => [n, manglerOppsett(n, blokker, bir)] as const).filter(([, m]) => m);

  return (
    <div className="ot-velger">
      <div className="ot-velger-tittel">
        {feltNavn(mal, valgt)}: hva skal vises her?
      </div>
      <div className="ot-filter">
        {FASTE.map((n) => chip(n, INNEBYGD_NAVN[n]))}
      </div>
      <div className="ot-velger-gruppe">
        <span className="field-note">Vær og avganger</span>
        <div className="ot-filter">
          {blokker.map((b) => chip(b.nokkel, b.navn))}
          {kanLageBlokk && (
            <>
              <button type="button" className="ot-chip" onClick={() => onNyBlokk("vaer")}>
                <Plus size={12} aria-hidden /> Vær
              </button>
              <button type="button" className="ot-chip" onClick={() => onNyBlokk("avganger")}>
                <Plus size={12} aria-hidden /> Avganger
              </button>
            </>
          )}
          {blokker.length === 0 && !kanLageBlokk && <span className="field-note">Ikke satt opp ennå.</span>}
        </div>
      </div>
      <div className="field-note">
        {valgt === STRIPE
          ? "Stripen er en smal linje nederst. Flere valg vises side om side, og en tom stripe tar ingen plass."
          : "Velger du flere, bytter feltet mellom dem."}
      </div>
      {mangler.map(([n, m]) => (
        <div key={n} className="ot-varsel">
          <AlertTriangle size={13} aria-hidden /> {blokkNavn(n, blokker)}: {m}. Feltet viser ingenting før det er rettet.
        </div>
      ))}
    </div>
  );
}
