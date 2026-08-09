"use client";

import { useEffect, useState } from "react";
import { datoTid } from "@/components/felles";
import { api } from "@/lib/klient";
import { Ramme } from "../ramme";

type Lead = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  message: string | null;
  status: string;
  createdAt: string;
};

/** Henvendelser fra landingssiden. Uten denne siden ville skjemaet vært en svart boks. */
export default function Leads() {
  const [liste, setListe] = useState<Lead[] | null>(null);
  const [feil, setFeil] = useState<string | null>(null);

  useEffect(() => {
    api
      .hent<Lead[]>("/plattform/leads")
      .then(setListe)
      .catch((e) => setFeil(e instanceof Error ? e.message : "Kunne ikke hente henvendelsene"));
  }, []);

  return (
    <Ramme tittel="Henvendelser">
      {feil && <div className="feilmelding">{feil}</div>}
      {!liste ? (
        <p className="pf-dempet">Henter …</p>
      ) : liste.length === 0 ? (
        <p className="pf-dempet">Ingen henvendelser ennå.</p>
      ) : (
        <div className="pf-kort">
          {liste.map((l) => (
            <div key={l.id} className="pf-lead">
              <div style={{ minWidth: 0 }}>
                <span className="pf-navn">{l.name}</span>
                <span className="pf-under">
                  <a className="pf-lenke-inline" href={`mailto:${l.email}`}>{l.email}</a>
                  {l.phone && ` · ${l.phone}`}
                  {l.company && ` · ${l.company}`}
                </span>
                {l.message && <p className="pf-lead-melding">{l.message}</p>}
              </div>
              <span className="pf-celle">{datoTid(l.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
    </Ramme>
  );
}
