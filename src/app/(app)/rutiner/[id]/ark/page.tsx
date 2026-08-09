"use client";

import { use, useEffect, useState } from "react";
import { Skall } from "../../../oppgaver/[id]/ark/page";
import { useOkt } from "@/components/OktProvider";
import { api } from "@/lib/klient";

/**
 * Rutinearket. Henges opp der rutinen gjelder — brannsentralen, fyrrommet, tavlerommet.
 *
 * Forskjellen fra oppgavearket er hva papiret er til: oppgavearket skal SKANNES for å
 * kvittere ut, rutinearket skal LESES i en situasjon. Derfor står stegene i full bredde her,
 * og QR-koden er en henvisning til den oppdaterte versjonen — ikke hovedsaken.
 */
export default function Rutineark({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { aktivOrg } = useOkt();
  const [ark, setArk] = useState<Ark | null>(null);
  const [feil, setFeil] = useState<string | null>(null);

  useEffect(() => {
    if (!aktivOrg) return;
    api
      .hent<Ark>(`/organizations/${aktivOrg.id}/routines/${id}/ark`)
      .then(setArk)
      .catch((e) => setFeil(e instanceof Error ? e.message : "Kunne ikke hente arket"));
  }, [aktivOrg, id]);

  if (feil) return <Skall><p className="ark-feil">{feil}</p></Skall>;
  if (!ark) return <Skall><p className="ark-feil">Henter arket …</p></Skall>;

  return (
    <Skall tilbake={`/rutiner/${id}`}>
      <div className="ark">
        <header className="ark-merke">
          <div className="ark-logo">
            <span className="ark-mark" aria-hidden>IQ</span>
            <span className="ark-navn">Drift<span>IQ</span></span>
          </div>
          <span className="ark-dok">Rutine</span>
        </header>

        <div className="ark-kunde">
          <div className="ark-overtittel">Borettslag</div>
          <h1>{ark.orgNavn}</h1>
        </div>

        <div className={`ark-band${ark.kritisk ? " kritisk" : ""}`}>
          <span className="ark-kicker">
            {ark.kritisk ? "Akuttrutine" : "Rutine"}
            {ark.kategori ? ` · ${ark.kategori}` : ""}
          </span>
          <h2>{ark.tittel}</h2>
          <div className="ark-fakta">
            <div>Versjon: <b>{ark.versjon}</b></div>
          </div>
        </div>

        <div className="ark-hoved rutine">
          <div className="ark-venstre">
            {ark.beskrivelse && <p className="ark-tekst">{ark.beskrivelse}</p>}
            <ol className="ark-steg">
              {ark.steg.map((s, i) => (
                <li key={s.id} className={s.kritisk ? "kritisk" : undefined}>
                  <span className="ark-nr" aria-hidden>{i + 1}</span>
                  <div style={{ minWidth: 0 }}>
                    <div className="ark-steg-tittel">{s.tittel}</div>
                    {s.beskrivelse && <div className="ark-steg-tekst">{s.beskrivelse}</div>}
                    {s.varselTekst && <div className="ark-varsel">{s.varselTekst}</div>}
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <aside className="ark-qr smal">
            <div className="ark-skann">Alltid oppdatert</div>
            {/* Vanlig <img>, ikke next/image: kilden er en data-URI som allerede er ferdig,
                og Image ville lagt på lazy-loading og optimalisering som gjør at koden kan
                mangle i utskriften. Et ark med tom QR-rute er verdiløst. */}
            <img src={ark.qr} alt="QR-kode" />
            <p className="ark-hvordan">
              Skann for å lese rutinen på mobilen. Nettversjonen er alltid den gjeldende —
              dette arket kan være en eldre utskrift.
            </p>
          </aside>
        </div>

        <footer className="ark-fot">
          <span><span className="ark-prikk" aria-hidden /> Levert med DriftIQ</span>
          <span>Generert {new Date().toLocaleDateString("nb-NO")} · driftiq.no</span>
        </footer>
      </div>
    </Skall>
  );
}

type Ark = {
  tittel: string;
  beskrivelse: string | null;
  kategori: string | null;
  kritisk: boolean;
  versjon: number;
  orgNavn: string;
  skannUrl: string;
  qr: string;
  steg: Array<{
    id: string;
    tittel: string;
    beskrivelse: string | null;
    kritisk: boolean;
    varselType: string | null;
    varselTekst: string | null;
  }>;
};
