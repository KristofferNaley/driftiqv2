"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/klient";
import { Underside } from "../underside";

/**
 * Hvem som får e-post om nye leads og innmeldinger. Lå nederst på Prismodell til
 * Innstillinger fikk egen underside for det (01.10.2026); lagringen er uendret
 * (`pricing_config.leads_notify_emails`, se `plattformVarslingsadresser`).
 */
export default function Varsler() {
  const [mottakere, setMottakere] = useState<string[] | null>(null);
  const [ny, setNy] = useState("");
  const [feil, setFeil] = useState<string | null>(null);

  useEffect(() => {
    api
      .hent<string[]>("/plattform/varselmottakere")
      .then(setMottakere)
      .catch((e) => setFeil(e instanceof Error ? e.message : "Kunne ikke hente mottakerne"));
  }, []);

  async function lagre(neste: string[]) {
    setFeil(null);
    try {
      setMottakere(await api.endre<string[]>("/plattform/varselmottakere", { epostadresser: neste }));
      setNy("");
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke lagre mottakerne");
    }
  }

  return (
    <Underside tittel="Varsler" ingress="Hvem som får e-post når noe skjer på plattformen.">
      {feil && <div className="feilmelding">{feil}</div>}
      <div className="pf-kort">
        <div className="pf-kort-hode"><span>E-post ved nye leads og innmeldinger</span></div>
        <div className="pf-kort-kropp">
          {!mottakere ? (
            <p className="pf-dempet">Henter …</p>
          ) : (
            <>
              {mottakere.length === 0 && (
                <p className="pf-dempet">Ingen adresser. Varslene går til adressen i miljøoppsettet.</p>
              )}
              {mottakere.map((adresse) => (
                <div key={adresse} className="pf-pm-rad">
                  <span>{adresse}</span>
                  <button
                    className="btn btn-ghost"
                    style={{ color: "var(--danger)", padding: "2px 8px" }}
                    onClick={() => void lagre(mottakere.filter((a) => a !== adresse))}
                  >
                    Fjern
                  </button>
                </div>
              ))}
              <form
                style={{ display: "flex", gap: "8px", marginTop: "10px" }}
                onSubmit={(e) => {
                  e.preventDefault();
                  const adresse = ny.trim().toLowerCase();
                  if (adresse && !mottakere.includes(adresse)) void lagre([...mottakere, adresse]);
                }}
              >
                <input
                  className="input"
                  type="email"
                  style={{ flex: 1, minWidth: 0 }}
                  placeholder="navn@driftiq.no"
                  aria-label="Ny varselmottaker"
                  value={ny}
                  onChange={(e) => setNy(e.target.value)}
                />
                <button className="btn" disabled={!ny.trim()}>Legg til</button>
              </form>
            </>
          )}
        </div>
      </div>
    </Underside>
  );
}
