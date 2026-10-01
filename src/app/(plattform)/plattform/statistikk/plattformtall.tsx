"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/klient";

/**
 * Plattformtallene som sto på Dashboard, flyttet hit da forsiden ble «I dag» (01.10.2026).
 *
 * Foreløpig plassering til ny Statistikk er bygget — da får tallene sin plass der. Oppgaver,
 * avvik og kvitteringer er kundenes eget arbeid, som resten av denne siden holder seg unna
 * med vilje; de står her bare for at ingenting skal forsvinne i flyttingen.
 */
type Nokkeltall = {
  aktiveKunder: number;
  inaktiveKunder: number;
  aktiveOppgaver: number;
  apneAvvik: number;
  kvitteringer: number;
  arligSalg: number;
  aiSporsmal: number;
  aiTokens: number;
};

export function Plattformtall() {
  const [d, setD] = useState<Nokkeltall | null>(null);

  useEffect(() => {
    // Feiler kallet, står resten av siden uten disse. Det er ikke verdt en feilmelding.
    api.hent<Nokkeltall>("/plattform/nokkeltall").then(setD).catch(() => {});
  }, []);

  if (!d) return null;
  const tall = (n: number) => n.toLocaleString("nb-NO");

  return (
    <>
      <div className="pf-kpi-grid">
        <Kpi etikett="Aktive kunder" verdi={tall(d.aktiveKunder)} under={`${d.inaktiveKunder} inaktive`} />
        <Kpi etikett="Aktive oppgaver" verdi={tall(d.aktiveOppgaver)} under="På tvers av alle kunder" />
        <Kpi etikett="Åpne avvik" verdi={tall(d.apneAvvik)} under="Totalt på plattformen" />
        <Kpi etikett="Kvitteringer" verdi={tall(d.kvitteringer)} under="Totalt registrert" />
        <Kpi etikett="Årlig salg" verdi={`${tall(d.arligSalg)} kr`} under="Sum av alle abonnement" />
      </div>

      <div className="pf-kort">
        <div className="pf-kort-hode"><span>AI-rådgiver siste 30 dager</span></div>
        <div className="pf-kort-kropp">
          <div className="pf-felt">
            <span className="pf-under">Spørsmål besvart</span>
            <span>{tall(d.aiSporsmal)}</span>
          </div>
          <div className="pf-felt">
            <span className="pf-under">Tokens brukt</span>
            <span>{tall(d.aiTokens)}</span>
          </div>
          {/* Tokens, ikke kroner: prisen per token endres, og et lagret kronebeløp ville
              vært feil dagen etter. */}
          <p className="pf-dempet" style={{ marginTop: "8px" }}>
            Vist i tokens og ikke kroner. Prisen per token endres, og et lagret beløp ville vært
            feil dagen etter.
          </p>
        </div>
      </div>
    </>
  );
}

function Kpi({ etikett, verdi, under }: { etikett: string; verdi: string; under: string }) {
  return (
    <div className="pf-kpi">
      <div className="pf-kpi-etikett">{etikett}</div>
      <div className="pf-kpi-verdi">{verdi}</div>
      <div className="pf-under">{under}</div>
    </div>
  );
}
