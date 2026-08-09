"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { datoTid } from "@/components/felles";
import { api } from "@/lib/klient";
import { Ramme } from "../ramme";

type Sesjon = {
  id: string;
  adminNavn: string | null;
  orgId: string;
  orgNavn: string;
  grunn: string;
  startet: string;
  utloper: string | null;
  avsluttet: string | null;
};

/**
 * Innsynsloggen på tvers av alle kunder.
 *
 * «Hvem har innsyn akkurat nå?» skal kunne besvares på ett sted. Måtte man åpne hver kunde
 * for seg, ville svaret i praksis vært utilgjengelig — og en logg ingen kan lese er ikke en
 * kontroll.
 */
export default function Support() {
  const [sesjoner, setSesjoner] = useState<Sesjon[] | null>(null);
  const [feil, setFeil] = useState<string | null>(null);

  useEffect(() => {
    api
      .hent<Sesjon[]>("/plattform/sesjoner")
      .then(setSesjoner)
      .catch((e) => setFeil(e instanceof Error ? e.message : "Kunne ikke hente loggen"));
  }, []);

  const naa = Date.now();
  const gjeldende = (s: Sesjon) =>
    !s.avsluttet && s.utloper !== null && new Date(s.utloper).getTime() > naa;

  return (
    <Ramme tittel="Support-modus">
      {feil && <div className="feilmelding">{feil}</div>}
      {!sesjoner ? (
        <p className="pf-dempet">Henter …</p>
      ) : sesjoner.length === 0 ? (
        <p className="pf-dempet">Ingen har hatt support-innsyn ennå.</p>
      ) : (
        <div className="pf-kort">
          <div className="pf-sesjonsrad hode">
            <span>Kunde</span>
            <span>Plattformadmin</span>
            <span>Begrunnelse</span>
            <span>Tidsrom</span>
          </div>
          {sesjoner.map((s) => (
            <div key={s.id} className={`pf-sesjonsrad${gjeldende(s) ? " gjeldende" : ""}`}>
              <Link href={`/plattform/kunder/${s.orgId}`} className="pf-navn pf-lenke-inline">
                {s.orgNavn}
              </Link>
              <span className="pf-celle">{s.adminNavn ?? "Slettet bruker"}</span>
              <span className="pf-celle">«{s.grunn}»</span>
              <span className="pf-celle">
                {datoTid(s.startet)}
                {s.avsluttet
                  ? ` → ${datoTid(s.avsluttet)}`
                  : gjeldende(s)
                    ? ` → pågår, utløper ${datoTid(s.utloper)}`
                    : " → utløpt"}
              </span>
            </div>
          ))}
        </div>
      )}
    </Ramme>
  );
}
