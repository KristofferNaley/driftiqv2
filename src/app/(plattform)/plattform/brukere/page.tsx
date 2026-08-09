"use client";

import { useCallback, useEffect, useState } from "react";
import { useOkt } from "@/components/OktProvider";
import { datoTid, initialer, siden } from "@/components/felles";
import { api } from "@/lib/klient";
import { Ramme } from "../ramme";

type Plattformbruker = {
  id: string;
  navn: string;
  epost: string;
  rolle: string;
  aktiv: boolean;
  sistInnlogget: string | null;
  opprettet: string | null;
  kundemedlemskap: string[];
};

/**
 * DriftIQs egne ansatte. Ikke kundenes brukere — de administreres inne hos hver kunde.
 *
 * `kontoansvarlig` fra v1 tilbys ikke: rollen er ikke implementert i v2s tilgangslag, og en
 * rolle som ser ut til å gi tilgang uten å gjøre det er verre enn ingen rolle.
 */
export default function Plattformbrukere() {
  const { bruker: innlogget } = useOkt();
  const [liste, setListe] = useState<Plattformbruker[] | null>(null);
  const [feil, setFeil] = useState<string | null>(null);
  const [navn, setNavn] = useState("");
  const [epost, setEpost] = useState("");
  const [jobber, setJobber] = useState(false);
  const [melding, setMelding] = useState<string | null>(null);

  const last = useCallback(async () => {
    try {
      setListe(await api.hent<Plattformbruker[]>("/plattform/brukere"));
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke hente brukerne");
    }
  }, []);

  useEffect(() => {
    void last();
  }, [last]);

  async function opprett(e: React.FormEvent) {
    e.preventDefault();
    setJobber(true);
    setFeil(null);
    setMelding(null);
    try {
      await api.send("/plattform/brukere", { name: navn.trim(), email: epost.trim() });
      setMelding(`${epost.trim()} har fått en engangslenke for å sette passord.`);
      setNavn("");
      setEpost("");
      await last();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke opprette brukeren");
    } finally {
      setJobber(false);
    }
  }

  async function endre(id: string, data: Record<string, unknown>) {
    setFeil(null);
    setMelding(null);
    try {
      await api.endre(`/plattform/brukere/${id}`, data);
      await last();
    } catch (e) {
      // «Du kan ikke endre din egen rolle» og «minst én aktiv plattformadmin» kommer hit.
      setFeil(e instanceof Error ? e.message : "Kunne ikke lagre");
    }
  }

  return (
    <Ramme tittel="Plattformbrukere">
      {feil && <div className="feilmelding">{feil}</div>}
      {melding && <div className="pf-varsel" style={{ cursor: "default" }}>{melding}</div>}

      <div className="pf-kort">
        <div className="pf-kort-hode"><span>Ny plattformadmin</span></div>
        <div className="pf-kort-kropp">
          <form onSubmit={opprett} style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <input
              className="input" style={{ flex: "1 1 180px" }} placeholder="Navn"
              aria-label="Navn" value={navn} onChange={(e) => setNavn(e.target.value)}
            />
            <input
              className="input" style={{ flex: "1 1 220px" }} type="email" placeholder="E-postadresse"
              aria-label="E-postadresse" value={epost} onChange={(e) => setEpost(e.target.value)}
            />
            <button className="btn btn-primary" disabled={jobber || !navn.trim() || !epost.trim()}>
              {jobber ? "Oppretter …" : "Opprett"}
            </button>
          </form>
          <p className="pf-dempet" style={{ marginTop: "10px" }}>
            Du setter ikke passordet. Brukeren får en engangslenke og velger det selv — da
            kjenner ingen andre det. Finnes adressen fra før, heves den kontoen i stedet.
          </p>
        </div>
      </div>

      {!liste ? (
        <p className="pf-dempet">Henter …</p>
      ) : (
        <div className="pf-kort">
          <div className="pf-kort-hode"><span>Plattformadmins ({liste.length})</span></div>
          {liste.map((b) => {
            const megSelv = b.id === innlogget?.id;
            return (
              <div key={b.id} className="pf-brukerrad">
                <span className="pf-mark liten" aria-hidden style={{ opacity: b.aktiv ? 1 : 0.4 }}>
                  {initialer(b.navn)}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span className="pf-navn">
                    {b.navn}
                    {megSelv && <span className="pf-meg">deg</span>}
                  </span>
                  <span className="pf-under">{b.epost}</span>
                </span>
                <span className="pf-celle">
                  {b.sistInnlogget ? siden(b.sistInnlogget) : "aldri"}
                </span>
                <span style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  {!b.aktiv && <span className="badge muted">Deaktivert</span>}
                  {/* Medlemskap hos kunder er verdt å se: gaten IGNORERER dem for
                      plattformadmin, så de gir en falsk trygghet om at personen «har
                      tilgang til» laget sitt. */}
                  {b.kundemedlemskap.length > 0 && (
                    <span className="badge info" title={b.kundemedlemskap.join(", ")}>
                      {b.kundemedlemskap.length} kundemedlemskap
                    </span>
                  )}
                </span>
                <span style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                  {/* Egen rolle og aktivstatus kan ikke endres — hindrer utestenging, og
                      gjør loggen entydig: en rolleendring er alltid noe én gjorde med en
                      ANNEN. */}
                  <button
                    className="btn btn-ghost"
                    disabled={megSelv}
                    title={megSelv ? "Du kan ikke endre din egen tilgang" : undefined}
                    onClick={() => void endre(b.id, { active: !b.aktiv })}
                  >
                    {b.aktiv ? "Deaktiver" : "Aktiver"}
                  </button>
                  <button
                    className="btn btn-ghost fjern-knapp"
                    style={{ width: "auto" }}
                    disabled={megSelv}
                    title={megSelv ? "Du kan ikke endre din egen tilgang" : undefined}
                    onClick={() => void endre(b.id, { role: "member" })}
                  >
                    Fjern plattformtilgang
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      )}

      <p className="pf-dempet">
        Kundenes egne brukere administreres inne hos hver kunde, ikke her. Rollen
        «kontoansvarlig» fra v1 er ikke portert — den er ikke implementert i tilgangslaget.
      </p>
      {liste?.[0]?.opprettet && (
        <p className="pf-dempet">Eldste konto opprettet {datoTid(liste[0].opprettet)}.</p>
      )}
    </Ramme>
  );
}
