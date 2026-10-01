"use client";

import { useState } from "react";
import { datoTid } from "@/components/felles";
import { api } from "@/lib/klient";
import { NIVA_ETIKETT } from "@/lib/nivaer";
import type { Kunde } from "./deler";

/** Fanen «Tilgang»: hvem som har tilgang til kunden, og hvem fra oss som har hatt innsyn. */
export function Tilgang({
  kunde,
  orgId,
  onEndret,
  onFeil,
}: {
  kunde: Kunde;
  orgId: string;
  onEndret: () => Promise<void>;
  onFeil: (f: string | null) => void;
}) {
  return (
    <>
      <Brukere kunde={kunde} />
      <Support kunde={kunde} orgId={orgId} onEndret={onEndret} onFeil={onFeil} />
      <Innsynslogg kunde={kunde} />
    </>
  );
}

// ── Support-modus ───────────────────────────────────────────────────────────────────────

function Support({
  kunde,
  orgId,
  onEndret,
  onFeil,
}: {
  kunde: Kunde;
  orgId: string;
  onEndret: () => Promise<void>;
  onFeil: (f: string | null) => void;
}) {
  const [grunn, setGrunn] = useState("");
  const [jobber, setJobber] = useState(false);

  const aktiv = kunde.sesjoner.find(
    (s) => !s.endedAt && s.expiresAt && new Date(s.expiresAt) > new Date(),
  );

  async function kjor(handling: () => Promise<unknown>, feiltekst: string) {
    setJobber(true);
    onFeil(null);
    try {
      await handling();
      setGrunn("");
      await onEndret();
    } catch (e) {
      onFeil(e instanceof Error ? e.message : feiltekst);
    } finally {
      setJobber(false);
    }
  }

  return (
    <div className={`pf-kort support${aktiv ? " aktiv" : ""}`}>
      <div className="pf-kort-hode">
        <span>Support-modus</span>
        {aktiv && <span className="badge warn">Aktiv</span>}
      </div>
      <div className="pf-kort-kropp">
        {aktiv ? (
          <>
            <p className="pf-tekst">
              Du har innsyn i denne kundens data til <b>{datoTid(aktiv.expiresAt)}</b>.
              Begrunnelse: «{aktiv.reason}»
            </p>
            <button
              className="btn btn-ghost fjern-knapp"
              disabled={jobber}
              onClick={() =>
                void kjor(
                  () => api.slett(`/plattform/support?orgId=${orgId}`),
                  "Kunne ikke avslutte support-modus",
                )
              }
            >
              Avslutt support-modus
            </button>
          </>
        ) : (
          <>
            <p className="pf-tekst">
              Uten support-modus har du <b>ingen</b> tilgang til kundens oppgaver, avvik eller
              beboerdata — panelet viser bare kundeforholdet. Innsynet logges med begrunnelse og
              utløper automatisk etter {kunde.maksTimer} timer.
            </p>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <input
                className="input"
                style={{ flex: "1 1 260px" }}
                placeholder="Hvorfor trenger du innsyn?"
                aria-label="Begrunnelse for innsyn"
                value={grunn}
                onChange={(e) => setGrunn(e.target.value)}
              />
              <button
                className="btn btn-primary"
                disabled={jobber || grunn.trim().length < 3}
                onClick={() =>
                  void kjor(
                    () => api.send("/plattform/support", { orgId, reason: grunn.trim() }),
                    "Kunne ikke starte support-modus",
                  )
                }
              >
                Start support-modus
              </button>
            </div>
          </>
        )}
      </div>
    </div>
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
