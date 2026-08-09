"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useOkt } from "@/components/OktProvider";
import { api } from "@/lib/klient";
import { Ramme } from "./ramme";

type Kunde = {
  id: string;
  navn: string;
  orgNr: string | null;
  orgForm: string | null;
  kommune: string | null;
  antallEnheter: number | null;
  aktiv: boolean;
  antallBrukere: number;
  harAktivSupport: boolean;
};

export default function Plattform() {
  const { bruker, laster } = useOkt();
  const [kunder, setKunder] = useState<Kunde[] | null>(null);
  const [feil, setFeil] = useState<string | null>(null);

  useEffect(() => {
    api
      .hent<Kunde[]>("/plattform/kunder")
      .then(setKunder)
      .catch((e) => setFeil(e instanceof Error ? e.message : "Kunne ikke hente kundene"));
  }, []);

  // Klientsidesjekk = hva som TEGNES. Serveren avviser uansett; dette er for å slippe å
  // vise en tom side med en feilmelding til noen som ikke skal være her.
  if (!laster && bruker && bruker.role !== "superadmin") {
    return (
      <Ramme tittel="Plattform">
        <p className="pf-dempet">Denne siden krever plattformadmin-tilgang.</p>
      </Ramme>
    );
  }

  return (
    <Ramme tittel="Kunder">
      {feil && <div className="feilmelding">{feil}</div>}
      {!kunder ? (
        <p className="pf-dempet">Henter …</p>
      ) : (
        <div className="pf-kort">
          <div className="pf-rad hode">
            <span>Kunde</span>
            <span>Org.form</span>
            <span>Enheter</span>
            <span>Brukere</span>
            <span>Status</span>
          </div>
          {kunder.map((k) => (
            <Link key={k.id} className="pf-rad" href={`/plattform/kunder/${k.id}`}>
              <span style={{ minWidth: 0 }}>
                <span className="pf-navn">{k.navn}</span>
                <span className="pf-under">{k.orgNr ?? "Uten org.nr."} · {k.kommune ?? "—"}</span>
              </span>
              <span className="pf-celle">{k.orgForm ?? "—"}</span>
              <span className="pf-celle">{k.antallEnheter ?? "—"}</span>
              <span className="pf-celle">{k.antallBrukere}</span>
              <span style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                {!k.aktiv && <span className="badge muted">Inaktiv</span>}
                {/* Aktivt innsyn skal være synlig i OVERSIKTEN, ikke bare inne på kunden.
                    En glemt sesjon man må klikke seg inn for å se, er en glemt sesjon. */}
                {k.harAktivSupport && <span className="badge warn">Support aktiv</span>}
              </span>
            </Link>
          ))}
        </div>
      )}
    </Ramme>
  );
}
