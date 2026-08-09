"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useOkt } from "@/components/OktProvider";
import { initialer } from "@/components/felles";
import { FREQ_ETIKETTER } from "@/lib/oppgaveregler";
import { api } from "@/lib/klient";

/**
 * Oppslagsarket til å henge opp der jobben gjøres — typisk teknisk rom.
 *
 * Egen rute UTENFOR `Layout`: hele siden er ett A4-ark som skal printes rent, og en sidemeny
 * på papiret gir ingen mening. Ctrl+P gir PDF-en; det trengs ikke noe PDF-bibliotek.
 *
 * QR-koden kommer ferdig som data-URI fra API-et, så arket kan aldri printes med en tom
 * rute — se `lib/ark.ts`.
 */
export default function Oppgaveark({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { aktivOrg } = useOkt();
  const [ark, setArk] = useState<Ark | null>(null);
  const [feil, setFeil] = useState<string | null>(null);

  useEffect(() => {
    if (!aktivOrg) return;
    api
      .hent<Ark>(`/organizations/${aktivOrg.id}/tasks/${id}/ark`)
      .then(setArk)
      .catch((e) => setFeil(e instanceof Error ? e.message : "Kunne ikke hente arket"));
  }, [aktivOrg, id]);

  if (feil) return <Skall><p className="ark-feil">{feil}</p></Skall>;
  if (!ark) return <Skall><p className="ark-feil">Henter arket …</p></Skall>;

  return (
    <Skall tilbake={`/oppgaver/${id}`}>
      <div className="ark">
        <header className="ark-merke">
          <div className="ark-logo">
            <span className="ark-mark" aria-hidden>IQ</span>
            <span className="ark-navn">Drift<span>IQ</span></span>
          </div>
          <span className="ark-dok">Oppgaveark</span>
        </header>

        <div className="ark-kunde">
          <div className="ark-overtittel">Borettslag</div>
          <h1>{ark.orgNavn}</h1>
        </div>

        <div className="ark-band">
          <span className="ark-kicker">Oppgave{ark.sted ? ` · ${ark.sted}` : ""}</span>
          <h2>{ark.tittel}</h2>
          <div className="ark-fakta">
            <div>Frekvens: <b>{FREQ_ETIKETTER[ark.frekvens] ?? ark.frekvens}</b></div>
            {ark.leverandor && <div>Leverandør: <b>{ark.leverandor}</b></div>}
            {ark.sted && <div>Sted: <b>{ark.sted}</b></div>}
          </div>
        </div>

        <div className="ark-hoved">
          <div className="ark-venstre">
            {ark.beskrivelse && (
              <>
                <div className="ark-blokk">Hva skal gjøres</div>
                <p className="ark-tekst">{ark.beskrivelse}</p>
              </>
            )}
            {ark.sjekkliste.length > 0 && (
              <>
                <div className="ark-blokk" style={{ marginTop: "6mm" }}>Sjekkliste</div>
                <ul className="ark-sjekk">
                  {ark.sjekkliste.map((p) => (
                    <li key={p.id}>{p.text}</li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <aside className="ark-qr">
            <div className="ark-skann">Skann for å registrere</div>
            {/* Vanlig <img>, ikke next/image: kilden er en data-URI som allerede er ferdig,
                og Image ville lagt på lazy-loading og optimalisering som gjør at koden kan
                mangle i utskriften. Et ark med tom QR-rute er verdiløst. */}
            <img src={ark.qr} alt="QR-kode" />
            <p className="ark-hvordan">
              Åpne kameraet på mobilen og hold den over koden. Kvitter ut jobben eller meld
              avvik.
            </p>
            <div className="ark-url">{ark.skannUrl}</div>
          </aside>
        </div>

        {ark.ansvarligNavn && (
          <div className="ark-kontakt">
            <span className="ark-avatar">{initialer(ark.ansvarligNavn)}</span>
            <div>
              <div className="ark-rolle">Ansvarlig i styret</div>
              <div className="ark-person">{ark.ansvarligNavn}</div>
            </div>
            <div className="ark-naa">
              {ark.ansvarligEpost && <div><b>{ark.ansvarligEpost}</b></div>}
              <div>{ark.ansvarligTelefon || "Spørsmål? Ta kontakt."}</div>
            </div>
          </div>
        )}

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
  frekvens: string;
  sted: string | null;
  leverandor: string | null;
  orgNavn: string;
  ansvarligNavn: string | null;
  ansvarligEpost: string | null;
  ansvarligTelefon: string | null;
  sjekkliste: Array<{ id: string; text: string }>;
  skannUrl: string;
  qr: string;
};

export function Skall({ children, tilbake }: { children: React.ReactNode; tilbake?: string }) {
  return (
    <div className="ark-side">
      <div className="ark-verktoy">
        {tilbake ? <Link href={tilbake}>← Tilbake</Link> : <span />}
        <button className="btn btn-primary" onClick={() => window.print()}>
          🖨 Skriv ut
        </button>
      </div>
      {children}
    </div>
  );
}
