"use client";

import { Felt } from "@/components/skjema";
import { tilOre } from "@/lib/okonomiregler";

/**
 * Beløpsfelt i KRONER. Verdien holdes som tekst i skjemaet (så «3 500,50» kan skrives
 * som man vil); kallstedet konverterer med `tilOre()` ved innsending, og bruker
 * `belopFeil()` for meldingen når teksten ikke er et beløp.
 */
export default function Belopfelt({
  etikett,
  verdi,
  onEndre,
  notat,
  plassholder = "0",
}: {
  etikett: string;
  verdi: string;
  onEndre: (v: string) => void;
  notat?: string;
  plassholder?: string;
}) {
  const ugyldig = verdi.trim() !== "" && tilOre(verdi) === null;
  return (
    <Felt etikett={etikett} notat={ugyldig ? "Skriv et beløp i kroner, f.eks. 3 500 eller 3500,50" : notat}>
      <div className="ok-belop">
        <input
          className="input"
          inputMode="decimal"
          value={verdi}
          placeholder={plassholder}
          aria-invalid={ugyldig || undefined}
          onChange={(e) => onEndre(e.target.value)}
        />
        <span className="ok-belop-enhet">kr</span>
      </div>
    </Felt>
  );
}

/** Feilmeldingen for et beløpsfelt, eller `null` når beløpet er gyldig. */
export function belopFeil(tekst: string, felt = "Beløpet"): string | null {
  if (!tekst.trim()) return `${felt} må fylles ut`;
  return tilOre(tekst) === null ? `${felt} er ikke et gyldig beløp` : null;
}
