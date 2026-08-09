"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useOkt } from "@/components/OktProvider";
import { api } from "@/lib/klient";
import { erPlattformadminRolle } from "@/lib/nivaer";
import { Ramme } from "./ramme";

type Dashbord = {
  aktiveKunder: number;
  inaktiveKunder: number;
  aktiveOppgaver: number;
  apneAvvik: number;
  kvitteringer: number;
  arligSalg: number;
  aiSporsmal: number;
  aiTokens: number;
  aktiveSesjoner: number;
};

export default function PlattformDashbord() {
  const { bruker, laster } = useOkt();
  const [d, setD] = useState<Dashbord | null>(null);
  const [feil, setFeil] = useState<string | null>(null);

  useEffect(() => {
    api
      .hent<Dashbord>("/plattform/dashbord")
      .then(setD)
      .catch((e) => setFeil(e instanceof Error ? e.message : "Kunne ikke hente tallene"));
  }, []);

  // Klientsidesjekk = hva som TEGNES. Serveren avviser uansett.
  if (!laster && bruker && !erPlattformadminRolle(bruker.role)) {
    return (
      <Ramme tittel="Plattform">
        <p className="pf-dempet">Denne siden krever plattformadmin-tilgang.</p>
      </Ramme>
    );
  }

  return (
    <Ramme tittel="Dashboard">
      {feil && <div className="feilmelding">{feil}</div>}
      {!d ? (
        <p className="pf-dempet">Henter …</p>
      ) : (
        <>
          {/* Aktivt innsyn står ØVERST og i egen farge. Er noen inne hos en kunde akkurat
              nå, er det den viktigste opplysningen på siden. */}
          {d.aktiveSesjoner > 0 && (
            <Link href="/plattform/support" className="pf-varsel">
              {d.aktiveSesjoner} aktiv{d.aktiveSesjoner === 1 ? "" : "e"} support-sesjon
              {d.aktiveSesjoner === 1 ? "" : "er"} akkurat nå — se hvem og hvorfor →
            </Link>
          )}

          <div className="pf-kpi-grid">
            <Kpi etikett="Aktive kunder" verdi={d.aktiveKunder} under={`${d.inaktiveKunder} inaktive`} />
            <Kpi etikett="Aktive oppgaver" verdi={d.aktiveOppgaver} under="På tvers av alle kunder" />
            <Kpi etikett="Åpne avvik" verdi={d.apneAvvik} under="Totalt på plattformen" />
            <Kpi etikett="Kvitteringer" verdi={d.kvitteringer} under="Totalt registrert" />
            <Kpi
              etikett="Årlig salg"
              verdi={`${d.arligSalg.toLocaleString("nb-NO")} kr`}
              under="Sum av alle abonnement"
            />
          </div>

          <div className="pf-kort">
            <div className="pf-kort-hode"><span>AI-rådgiver — siste 30 dager</span></div>
            <div className="pf-kort-kropp">
              <div className="pf-felt">
                <span className="pf-under">Spørsmål besvart</span>
                <span>{d.aiSporsmal.toLocaleString("nb-NO")}</span>
              </div>
              <div className="pf-felt">
                <span className="pf-under">Tokens brukt</span>
                <span>{d.aiTokens.toLocaleString("nb-NO")}</span>
              </div>
              {/* Tokens, ikke kroner: prisen per token endres, og et lagret kronebeløp ville
                  vært feil dagen etter. */}
              <p className="pf-dempet" style={{ marginTop: "8px" }}>
                Tokens og ikke kroner — prisen endres, og et lagret beløp ville vært feil
                dagen etter.
              </p>
            </div>
          </div>
        </>
      )}
    </Ramme>
  );
}

function Kpi({ etikett, verdi, under }: { etikett: string; verdi: number | string; under: string }) {
  return (
    <div className="pf-kpi">
      <div className="pf-kpi-etikett">{etikett}</div>
      <div className="pf-kpi-verdi">{verdi}</div>
      <div className="pf-under">{under}</div>
    </div>
  );
}
