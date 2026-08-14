"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useOkt } from "@/components/OktProvider";
import { dato } from "@/components/felles";
import { internkontroll, type GjennomgangDetalj } from "@/lib/klient";
import { KONSEKVENS_ORD, NIVATEKST, SANNSYNLIGHET_ORD, FARESTATUS_ETIKETT } from "@/lib/risikoord";

/**
 * Utskriftsarket for en fullført risikogjennomgang — protokollen på papir.
 *
 * Egen rute UTENFOR `Layout`, som oppgavearket: Ctrl+P gir PDF-en, uten PDF-bibliotek.
 * I motsetning til oppgavearket er dette FLERSIDIG (`.ark-flersidig`) — tabellen vokser
 * med antall farer, og utskriften bryter mellom radene. Innholdet er øyeblikksbildet fra
 * gjennomgangen, aldri dagens register — det er hele poenget med protokollen.
 */
export default function Risikoark({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { aktivOrg } = useOkt();
  const [ark, setArk] = useState<GjennomgangDetalj | null>(null);
  const [feil, setFeil] = useState<string | null>(null);

  useEffect(() => {
    if (!aktivOrg) return;
    internkontroll
      .hentGjennomgang(aktivOrg.id, id)
      .then(setArk)
      .catch((e) => setFeil(e instanceof Error ? e.message : "Kunne ikke hente gjennomgangen"));
  }, [aktivOrg, id]);

  if (feil) return <Skall><p className="ark-feil">{feil}</p></Skall>;
  if (!ark) return <Skall><p className="ark-feil">Henter protokollen …</p></Skall>;

  // Kategoriene i lagret rekkefølge — hver får en seksjonsrad, som i kundens gamle skjema.
  const seksjoner: Array<[string, GjennomgangDetalj["punkter"]]> = [];
  for (const p of ark.punkter) {
    const navn = p.category ?? "Annet";
    const siste = seksjoner[seksjoner.length - 1];
    if (siste && siste[0] === navn) siste[1].push(p);
    else seksjoner.push([navn, [p]]);
  }

  return (
    <Skall tilbake="/internkontroll">
      <div className="ark ark-flersidig">
        <header className="ark-merke">
          <div className="ark-logo">
            <span className="ark-mark" aria-hidden>IQ</span>
            <span className="ark-navn">Drift<span>IQ</span></span>
          </div>
          <span className="ark-dok">Risikovurdering</span>
        </header>

        <div className="ark-kunde">
          <div className="ark-overtittel">Protokoll</div>
          <h1>{aktivOrg?.name}</h1>
        </div>

        <div className="ark-band">
          <span className="ark-kicker">Risikogjennomgang</span>
          <h2>{ark.context ?? "Løpende drift"}</h2>
          <div className="ark-fakta">
            <div>Gjennomført: <b>{dato(ark.reviewDate)}</b></div>
            {ark.participants && <div>Deltakere: <b>{ark.participants}</b></div>}
            <div>Farer vurdert: <b>{ark.punkter.length}</b></div>
          </div>
        </div>

        <div className="ark-rtab-wrap">
          <table className="ark-rtab">
            <thead>
              <tr>
                <th style={{ width: "8mm" }}>Nr.</th>
                <th>Fare</th>
                <th style={{ width: "24mm" }}>Sannsynlighet</th>
                <th style={{ width: "20mm" }}>Konsekvens</th>
                <th style={{ width: "18mm" }}>Risiko</th>
                <th style={{ width: "58mm" }}>Beskrivelse og tiltak</th>
              </tr>
            </thead>
            <tbody>
              {seksjoner.map(([navn, punkter], sIdx) => (
                <SeksjonRader key={navn} navn={navn} punkter={punkter} nr={sIdx + 1} />
              ))}
            </tbody>
          </table>
        </div>

        {ark.conclusion && (
          <div className="ark-rkonk">
            <div className="ark-blokk">Styrets konklusjon</div>
            <p className="ark-tekst">{ark.conclusion}</p>
          </div>
        )}

        <footer className="ark-fot">
          <span><span className="ark-prikk" aria-hidden /> Levert med DriftIQ</span>
          <span>Protokoll låst {dato(ark.createdAt)} · driftiq.no</span>
        </footer>
      </div>
    </Skall>
  );
}

function SeksjonRader({
  navn,
  punkter,
  nr,
}: {
  navn: string;
  punkter: GjennomgangDetalj["punkter"];
  nr: number;
}) {
  return (
    <>
      <tr className="ark-rkat">
        <td>{nr}.0</td>
        <td colSpan={5}>{navn}</td>
      </tr>
      {punkter.map((p, i) => (
        <tr key={p.id}>
          <td>{nr}.{i + 1}</td>
          <td>
            {p.title}
            {(p.owner || p.status !== "open") && (
              <div className="beskrivelse">
                {[p.owner && `Ansvarlig: ${p.owner}`, p.status !== "open" && (FARESTATUS_ETIKETT[p.status] ?? p.status)]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            )}
          </td>
          <td>{p.probability ? SANNSYNLIGHET_ORD[p.probability - 1] : "—"}</td>
          <td>{p.consequence ? KONSEKVENS_ORD[p.consequence - 1] : "—"}</td>
          <td>
            {p.niva ? (
              <span className={`ark-rniva ${p.niva}`}>{NIVATEKST[p.niva]} {p.risiko}</span>
            ) : (
              <span className="ark-rniva ukjent">Ikke vurdert</span>
            )}
          </td>
          <td className="beskrivelse">
            {[p.description, p.actions && `Tiltak:\n${p.actions}`].filter(Boolean).join("\n\n") || "—"}
          </td>
        </tr>
      ))}
    </>
  );
}

function Skall({ children, tilbake }: { children: React.ReactNode; tilbake?: string }) {
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
