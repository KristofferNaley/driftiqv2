"use client";

import type { ReactNode } from "react";

/**
 * Nøkkeltall med fargebånd i toppen — mockupens `kpi-kort`, med modulprefiks. Kompakt
 * (`--fs-xl`), aldri linjebrudd i tallet: «1 440 000 kr» i hero-størrelse brakk over to
 * linjer og gjorde kortene dobbelt så høye som resten av siden.
 */
export default function Kpi({
  tone = "blaa",
  etikett,
  verdi,
  under,
}: {
  tone?: "blaa" | "gronn" | "gul" | "roed";
  etikett: string;
  verdi: ReactNode;
  under?: ReactNode;
}) {
  return (
    <div className={`card ok-kpi-kort ok-kpi-${tone}`}>
      <div className="ok-kpi-etikett">{etikett}</div>
      <div className="ok-kpi-tall">{verdi}</div>
      {under && <div className="ok-kpi-under">{under}</div>}
    </div>
  );
}
