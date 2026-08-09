"use client";

import { use, useEffect, useState } from "react";

/**
 * Offentlig rutinevisning bak en QR-kode. **Ingen innlogging.**
 *
 * Rutiner henges opp der de gjelder — brannsentralen, fyrrommet, tavlerommet — slik at den
 * som faktisk står der kan lese hva som skal gjøres. Ren lesevisning: det finnes ingenting
 * å sende inn, og derfor heller ingen skriverettighet å misbruke.
 */
export default function OffentligRutine({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [rutine, setRutine] = useState<Rutine | null>(null);
  const [feil, setFeil] = useState<string | null>(null);
  const [laster, setLaster] = useState(true);

  useEffect(() => {
    fetch(`/api/qr/rutine/${token}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail ?? "Ugyldig QR-kode");
        setRutine(await r.json());
      })
      .catch((e) => setFeil(e instanceof Error ? e.message : "Kunne ikke hente rutinen"))
      .finally(() => setLaster(false));
  }, [token]);

  return (
    <main className="qr-side">
      <div className="qr-kort">
        {laster ? (
          <p className="qr-dempet">Henter rutinen …</p>
        ) : feil || !rutine ? (
          <>
            <h1 className="qr-tittel">Ugyldig QR-kode</h1>
            <p className="qr-dempet">{feil} Ta kontakt med styret.</p>
          </>
        ) : (
          <>
            <div className="qr-hode">
              <div className="qr-org">{rutine.orgNavn}</div>
              <h1 className="qr-tittel">{rutine.tittel}</h1>
              <div className="qr-meta">Versjon {rutine.versjon}</div>
            </div>

            <div className="qr-skjema">
              {rutine.beskrivelse && <p className="qr-beskrivelse">{rutine.beskrivelse}</p>}

              {rutine.steg.length === 0 ? (
                <p className="qr-dempet">Rutinen har ingen steg ennå.</p>
              ) : (
                <ol className="qr-steg">
                  {rutine.steg.map((s, i) => (
                    <li key={s.id} className={s.kritisk ? "kritisk" : undefined}>
                      <div className="qr-steg-nr" aria-hidden>{i + 1}</div>
                      <div style={{ minWidth: 0 }}>
                        <div className="qr-steg-tittel">
                          {s.tittel}
                          {s.kritisk && <span className="qr-kritisk">Kritisk</span>}
                        </div>
                        {s.beskrivelse && <p className="qr-steg-tekst">{s.beskrivelse}</p>}
                        {s.varselTekst && (
                          <p className={`qr-varsel ${s.varselType ?? "info"}`}>{s.varselTekst}</p>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </>
        )}
      </div>
      <div className="qr-fot">
        <span className="logo-mark" aria-hidden>IQ</span>
        <span>DriftIQ</span>
      </div>
    </main>
  );
}

type Rutine = {
  tittel: string;
  beskrivelse: string | null;
  orgNavn: string;
  versjon: number;
  sistGjennomgatt: string | null;
  steg: Array<{
    id: string;
    tittel: string;
    beskrivelse: string | null;
    kritisk: boolean;
    varselType: string | null;
    varselTekst: string | null;
  }>;
};
