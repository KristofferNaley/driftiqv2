"use client";

import { useState } from "react";
import { datoTid } from "@/components/felles";
import { api } from "@/lib/klient";
import { NIVA_ETIKETT } from "@/lib/nivaer";
import type { Kunde } from "./deler";

/**
 * Fanen «Tilgang»: hvem som har tilgang til kunden, og hvem fra oss som har hatt innsyn.
 * Support-modus startes fra kundehodet (`hode.tsx`) og havner i innsynsloggen her.
 */
export function Tilgang({ kunde, onEndret }: { kunde: Kunde; onEndret: () => Promise<void> }) {
  return (
    <>
      <Brukere kunde={kunde} onEndret={onEndret} />
      <Innsynslogg kunde={kunde} />
    </>
  );
}

// ── Brukere og innsynslogg ──────────────────────────────────────────────────────────────

function Brukere({ kunde, onEndret }: { kunde: Kunde; onEndret: () => Promise<void> }) {
  const [jobber, setJobber] = useState<string | null>(null);
  const [feil, setFeil] = useState<string | null>(null);

  async function settAgent(brukerId: string, agent: boolean) {
    setJobber(brukerId);
    setFeil(null);
    try {
      await api.endre(`/plattform/agentkontoer/${brukerId}`, { agent });
      await onEndret();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke lagre agentmerket");
    } finally {
      setJobber(null);
    }
  }

  return (
    <div className="pf-kort">
      <div className="pf-kort-hode">
        <span>Brukere ({kunde.brukere.length})</span>
      </div>
      {feil && <div className="feilmelding">{feil}</div>}
      {kunde.brukere.length === 0 ? (
        <p className="pf-dempet" style={{ padding: "16px 18px" }}>
          Ingen brukere i denne organisasjonen.
        </p>
      ) : (
        <>
          <div className="pf-brukertabell hode">
            <span>Navn</span>
            <span>Rolle</span>
            <span>Sist innlogget</span>
          </div>
          {kunde.brukere.map((b) => (
            <div key={b.id} className="pf-brukertabell">
              <span style={{ minWidth: 0 }}>
                <span className="pf-navn">
                  {b.navn}
                  {/* Supportmedlemskap: teller ikke i onboarding eller aktivitet. */}
                  {b.plattform && <span className="pf-meg">Plattformadmin</span>}
                  {/* Testkonto: teller heller ikke (lib/kundebrukere.ts). */}
                  {b.agent && <span className="pf-meg">Agentkonto</span>}
                </span>
                <span className="pf-under">{b.epost}</span>
                {!b.plattform && (
                  <button
                    className="btn btn-ghost"
                    style={{ padding: "2px 8px", fontSize: "var(--fs-label)", marginTop: "4px" }}
                    disabled={jobber !== null}
                    onClick={() => void settAgent(b.id, !b.agent)}
                  >
                    {jobber === b.id ? "Lagrer …" : b.agent ? "Fjern agentmerket" : "Merk som agentkonto"}
                  </button>
                )}
              </span>
              <span className="pf-celle">{NIVA_ETIKETT[b.nivaa] ?? b.nivaa}</span>
              <span className={`pf-celle${b.sistInnlogget ? "" : " pf-ikke-satt"}`}>
                {b.sistInnlogget ? datoTid(b.sistInnlogget) : "Aldri"}
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function Innsynslogg({ kunde }: { kunde: Kunde }) {
  return (
    <div className="pf-kort">
      <div className="pf-kort-hode">
        <span>Innsynslogg</span>
      </div>
      <div className="pf-kort-kropp">
        {kunde.sesjoner.length === 0 ? (
          <p className="pf-dempet">Ingen har hatt support-innsyn hos denne kunden.</p>
        ) : (
          kunde.sesjoner.map((s) => (
            <div key={s.id} className="pf-sesjon">
              <div>
                <span className="pf-navn">{s.adminName ?? "Slettet bruker"}</span>
                <span className="pf-under">«{s.reason}»</span>
              </div>
              <span className="pf-celle">
                {datoTid(s.startedAt)}
                {s.endedAt
                  ? ` til ${datoTid(s.endedAt)}`
                  : s.expiresAt && new Date(s.expiresAt) <= new Date()
                    ? ` til ${datoTid(s.expiresAt)} (utløpt)`
                    : ", pågår"}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
