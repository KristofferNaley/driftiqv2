"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useOkt } from "@/components/OktProvider";
import { dato } from "@/components/felles";
import { internkontroll, type Runde } from "@/lib/klient";

/**
 * Utskriftsarket for en vernerunde — rapporten på papir, samme mønster som
 * risikovurderingsarket: egen rute utenfor `Layout`, DriftIQ-hode, flersidig tabell med
 * seksjonsrader, Ctrl+P gir PDF-en. Innholdet er rundens punkter med status, merknader og
 * avvikene som ble opprettet — dokumentasjonen av hva som ble observert den dagen.
 */

/** Trestatusen som pill i tabellen — fargene deles med risikoarket (.ark-rniva). */
const STATUSPILL: Record<string, { etikett: string; klasse: string }> = {
  ok: { etikett: "I orden", klasse: "lav" },
  avvik: { etikett: "Avvik", klasse: "hoy" },
  ikke_aktuelt: { etikett: "Ikke aktuelt", klasse: "ukjent" },
  ubesvart: { etikett: "Ikke sjekket", klasse: "middels" },
};

export default function Vernerundeark({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { aktivOrg } = useOkt();
  const [ark, setArk] = useState<Runde | null>(null);
  const [feil, setFeil] = useState<string | null>(null);

  useEffect(() => {
    if (!aktivOrg) return;
    internkontroll
      .hentRunde(aktivOrg.id, id)
      .then(setArk)
      .catch((e) => setFeil(e instanceof Error ? e.message : "Kunne ikke hente runden"));
  }, [aktivOrg, id]);

  if (feil) return <Skall><p className="ark-feil">{feil}</p></Skall>;
  if (!ark) return <Skall><p className="ark-feil">Henter rapporten …</p></Skall>;

  const besvarte = ark.punkter.filter((p) => p.status).length;
  const antallOk = ark.punkter.filter((p) => p.status === "ok").length;
  const antallAvvik = ark.punkter.filter((p) => p.status === "avvik").length;
  const avvikPerPunkt = new Map(ark.avvik.filter((a) => a.roundItemId).map((a) => [a.roundItemId!, a]));

  // Seksjonene i lagret rekkefølge — hver får en seksjonsrad med nummerering (1.0, 1.1 …).
  const seksjoner: Array<[string, Runde["punkter"]]> = [];
  for (const p of ark.punkter) {
    const navn = p.section ?? "Annet";
    const siste = seksjoner[seksjoner.length - 1];
    if (siste && siste[0] === navn) siste[1].push(p);
    else seksjoner.push([navn, [p]]);
  }

  return (
    <Skall tilbake={`/internkontroll/vernerunde/${id}`}>
      <div className="ark ark-flersidig">
        <header className="ark-merke">
          <div className="ark-logo">
            <span className="ark-mark" aria-hidden>IQ</span>
            <span className="ark-navn">Drift<span>IQ</span></span>
          </div>
          <span className="ark-dok">Vernerunde</span>
        </header>

        <div className="ark-kunde">
          <div className="ark-overtittel">Rapport</div>
          <h1>{aktivOrg?.name}</h1>
        </div>

        <div className="ark-band">
          <span className="ark-kicker">Vernerunde{ark.status !== "completed" && " · ikke fullført"}</span>
          <h2>{ark.title}</h2>
          <div className="ark-fakta">
            {ark.roundDate && <div>Befaring: <b>{dato(ark.roundDate)}</b></div>}
            {ark.deltakere.length > 0 && (
              <div>
                Deltakere:{" "}
                <b>{ark.deltakere.map((d) => (d.role ? `${d.name} (${d.role})` : d.name)).join(", ")}</b>
              </div>
            )}
            <div>
              Vurdert: <b>{besvarte} av {ark.punkter.length}</b> · I orden: <b>{antallOk}</b> ·
              Avvik: <b>{antallAvvik}</b>
            </div>
          </div>
        </div>

        <div className="ark-rtab-wrap">
          <table className="ark-rtab">
            <thead>
              <tr>
                <th style={{ width: "8mm" }}>Nr.</th>
                <th>Sjekkpunkt</th>
                <th style={{ width: "22mm" }}>Status</th>
                <th style={{ width: "56mm" }}>Merknad og avvik</th>
              </tr>
            </thead>
            <tbody>
              {seksjoner.map(([navn, punkter], sIdx) => (
                <SeksjonRader
                  key={navn}
                  navn={navn}
                  punkter={punkter}
                  nr={sIdx + 1}
                  avvikPerPunkt={avvikPerPunkt}
                />
              ))}
            </tbody>
          </table>
        </div>

        {ark.notes && (
          <div className="ark-rkonk">
            <div className="ark-blokk">Merknader til runden</div>
            <p className="ark-tekst">{ark.notes}</p>
          </div>
        )}

        <footer className="ark-fot">
          <span><span className="ark-prikk" aria-hidden /> Levert med DriftIQ</span>
          <span>
            {ark.status === "completed" ? "Fullført og låst" : "Utkast"} · generert{" "}
            {new Date().toLocaleDateString("nb-NO")} · driftiq.no
          </span>
        </footer>
      </div>
    </Skall>
  );
}

function SeksjonRader({
  navn,
  punkter,
  nr,
  avvikPerPunkt,
}: {
  navn: string;
  punkter: Runde["punkter"];
  nr: number;
  avvikPerPunkt: Map<string, { number: number | null; title: string }>;
}) {
  return (
    <>
      <tr className="ark-rkat">
        <td>{nr}.0</td>
        <td colSpan={3}>{navn}</td>
      </tr>
      {punkter.map((p, i) => {
        const pill = STATUSPILL[p.status ?? "ubesvart"] ?? STATUSPILL.ubesvart!;
        const avvik = avvikPerPunkt.get(p.id);
        return (
          <tr key={p.id}>
            <td>{nr}.{i + 1}</td>
            <td>{p.text}</td>
            <td>
              <span className={`ark-rniva ${pill.klasse}`}>{pill.etikett}</span>
            </td>
            <td className="beskrivelse">
              {[
                p.notes,
                avvik && `Avvik #${String(avvik.number ?? 0).padStart(3, "0")} — ${avvik.title}`,
              ]
                .filter(Boolean)
                .join("\n") || "—"}
            </td>
          </tr>
        );
      })}
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
