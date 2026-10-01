"use client";

import { datoTid } from "@/components/felles";
import { NIVA_ETIKETT } from "@/lib/nivaer";
import type { Kunde } from "./deler";

/**
 * Fanen «Tilgang»: hvem som har tilgang til kunden, og hvem fra oss som har hatt innsyn.
 * Support-modus startes fra kundehodet (`hode.tsx`) og havner i innsynsloggen her.
 */
export function Tilgang({ kunde }: { kunde: Kunde }) {
  return (
    <>
      <Brukere kunde={kunde} />
      <Innsynslogg kunde={kunde} />
    </>
  );
}

// ── Brukere og innsynslogg ──────────────────────────────────────────────────────────────

function Brukere({ kunde }: { kunde: Kunde }) {
  return (
    <div className="pf-kort">
      <div className="pf-kort-hode">
        <span>Brukere ({kunde.brukere.length})</span>
      </div>
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
                </span>
                <span className="pf-under">{b.epost}</span>
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
