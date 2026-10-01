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
      <div className="pf-kort-kropp">
        {kunde.brukere.length === 0 ? (
          <p className="pf-dempet">Ingen brukere i denne organisasjonen.</p>
        ) : (
          kunde.brukere.map((b) => (
            <div key={b.id} className="pf-bruker">
              <span style={{ minWidth: 0 }}>
                <span className="pf-navn">{b.navn}</span>
                <span className="pf-under">{b.epost}</span>
              </span>
              <span className="pf-celle">{NIVA_ETIKETT[b.nivaa] ?? b.nivaa}</span>
              <span className="pf-celle pf-dempet">
                {b.sistInnlogget ? datoTid(b.sistInnlogget) : "aldri innlogget"}
              </span>
            </div>
          ))
        )}
      </div>
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
          <p className="pf-dempet">Ingen har hatt support-innsyn i denne kunden.</p>
        ) : (
          kunde.sesjoner.map((s) => (
            <div key={s.id} className="pf-sesjon">
              <div>
                <span className="pf-navn">{s.adminName ?? "Slettet bruker"}</span>
                <span className="pf-under">«{s.reason}»</span>
              </div>
              <span className="pf-celle">
                {datoTid(s.startedAt)}
                {s.endedAt ? ` → ${datoTid(s.endedAt)}` : " → pågår"}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
