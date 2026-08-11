"use client";

import { use, useMemo, useState } from "react";
import Layout from "@/components/Layout";
import { Faner, Feil, Nokkeltall, Tom, useOrgData } from "@/components/felles";
import LeverandorDetaljModal from "@/components/LeverandorDetaljModal";
import NyLeverandorModal from "@/components/NyLeverandorModal";
import { leverandorer, type LeverandorIListe } from "@/lib/klient";

// Visningsnavn — databaseverdiene (avtale/handelskonto/adhoc) ligger fast. «Faste
// leverandører» og ikke «Avtale»: etiketten skal ikke love at en kontrakt er registrert,
// og «Handelskonto» var internsjargong for det som faktisk er innkjøpssteder med kundenummer.
const RELASJON: Record<string, string> = {
  avtale: "Faste leverandører",
  handelskonto: "Innkjøpssteder",
  adhoc: "Ved behov",
};

export default function Leverandorer({ searchParams }: { searchParams: Promise<{ apen?: string }> }) {
  // `?apen=<id>` åpner detaljmodalen direkte — det gamle /leverandorer/<id> omdirigerer hit.
  const { apen: apenStart } = use(searchParams);
  const { data, feil, laster, last, orgId } = useOrgData((o) => leverandorer.liste(o));
  const [apen, setApen] = useState<string | null>(apenStart ?? null);
  const [nyLeverandor, setNyLeverandor] = useState(false);
  const [fane, setFane] = useState<"avtale" | "handelskonto" | "adhoc">("avtale");
  const liste = useMemo(() => data ?? [], [data]);
  const vist = liste.filter((l) => l.relationshipType === fane);

  /**
   * Kortene svarer på det man faktisk lurer på i denne lista: hvor mange forhold har vi,
   * hvor mye av dem er avtalefestet, ligger det arbeid hos noen — og hvem mangler en
   * kontaktperson å ringe. Det siste er et hull man ellers oppdager den dagen man trenger
   * nummeret.
   */
  const kpi = useMemo(() => {
    const aktive = liste.filter((l) => l.active);
    return {
      aktive: aktive.length,
      avtaler: liste.reduce((s, l) => s + l.antallKontrakter, 0),
      oppgaver: liste.reduce((s, l) => s + l.antallOppgaver, 0),
      utenKontakt: aktive.filter((l) => !l.primaryContactName).length,
    };
  }, [liste]);

  // Relasjonstypen er horisontale faner, ikke seksjoner i tabellen: en seksjonstittel rett
  // under kolonneoverskriften «Navn» ble lest som en rad.

  return (
    <Layout
      tittel="Leverandører"
      handlinger={
        <button className="btn btn-primary" onClick={() => setNyLeverandor(true)}>
          ＋ Ny leverandør
        </button>
      }
      subnav={
        <Faner
          valgt={fane}
          onVelg={setFane}
          faner={Object.entries(RELASJON).map(([nokkel, etikett]) => ({
            nokkel: nokkel as "avtale" | "handelskonto" | "adhoc",
            etikett,
          }))}
        />
      }
    >
      <div className="page-content">
        <Feil melding={feil} />

        <div className="auto-grid">
          <Nokkeltall etikett="Aktive leverandører" verdi={kpi.aktive} />
          <Nokkeltall etikett="Løpende avtaler" verdi={kpi.avtaler} />
          <Nokkeltall etikett="Åpne oppgaver" verdi={kpi.oppgaver} />
          <Nokkeltall etikett="Mangler kontaktperson" verdi={kpi.utenKontakt} />
        </div>

        {/* Uten korttittel — «Leverandører» står allerede som sidetittel rett over, og
            fanene sier hvilken relasjonstype man ser på. */}
        <div className="card">
          {laster ? (
            <Tom tekst="Henter …" />
          ) : vist.length === 0 ? (
            <Tom
              tekst={
                liste.length === 0
                  ? "Ingen leverandører registrert ennå."
                  : `Ingen leverandører under «${RELASJON[fane]}».`
              }
            />
          ) : (
            <>
              <div className="leverandor-hode" aria-hidden>
                <span>Navn</span>
                <span className="leverandor-kontakt">Kontaktperson</span>
                <span className="leverandor-tall">Avtaler</span>
                <span className="leverandor-tall">Oppgaver</span>
              </div>
              {vist.map((l) => (
                <LeverandorRad key={l.id} l={l} onClick={() => setApen(l.id)} />
              ))}
            </>
          )}
        </div>
      </div>

      {apen && orgId && (
        <LeverandorDetaljModal orgId={orgId} id={apen} onLukk={() => setApen(null)} onEndret={last} />
      )}

      {nyLeverandor && orgId && (
        <NyLeverandorModal
          orgId={orgId}
          onLukk={() => setNyLeverandor(false)}
          onOpprettet={async (l) => {
            await last();
            // Rett inn i detaljen: neste steg etter oppretting er nesten alltid å legge inn
            // kontaktperson eller notat.
            setApen(l.id);
          }}
        />
      )}
    </Layout>
  );
}

function LeverandorRad({ l, onClick }: { l: LeverandorIListe; onClick: () => void }) {
  return (
    <div className="leverandor-rad" onClick={onClick}>
      <div style={{ minWidth: 0 }}>
        <div className="kontrakt-tittel">
          <span className="list-tittel">{l.name}</span>
          {l.ehf && <span className="badge muted" style={{ flexShrink: 0 }}>EHF</span>}
          {!l.active && <span className="badge muted" style={{ flexShrink: 0 }}>Inaktiv</span>}
        </div>
        {(l.category || l.orgNumber || l.customerNumber) && (
          <div className="list-meta">
            {[l.category, l.orgNumber, l.customerNumber && `kundenr ${l.customerNumber}`]
              .filter(Boolean)
              .join(" · ")}
          </div>
        )}
      </div>
      <span className="leverandor-celle leverandor-kontakt">{l.primaryContactName ?? "—"}</span>
      <span className="leverandor-tall">{l.antallKontrakter || "—"}</span>
      <span className="leverandor-tall">{l.antallOppgaver || "—"}</span>
    </div>
  );
}
