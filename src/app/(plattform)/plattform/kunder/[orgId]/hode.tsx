"use client";

import { useState } from "react";
import { dato, datoTid } from "@/components/felles";
import { Knapperad, Modal, Tekstfelt, useSending } from "@/components/skjema";
import { api } from "@/lib/klient";
import { selskapsformNavn } from "@/lib/selskapsform";
import { useAppLenke } from "../../../verter";
import type { Detalj, Kunde } from "./deler";

/** Pågående innsyn, eller `null`. Utløpte sesjoner uten `endedAt` regnes som avsluttet. */
export function aktivSesjon(kunde: Kunde) {
  return (
    kunde.sesjoner.find((s) => !s.endedAt && s.expiresAt && new Date(s.expiresAt) > new Date()) ??
    null
  );
}

/**
 * Kundehodet: navn, status-chips og de to handlingene som gjelder hele kunden. Support-modus
 * er en HANDLING, ikke en side — den kan startes uansett hvilken fane man står på.
 */
export function Kundehode({
  detalj,
  kunde,
  onRediger,
  onSupport,
}: {
  detalj: Detalj;
  kunde: Kunde;
  onRediger: () => void;
  onSupport: () => void;
}) {
  const { org } = detalj;
  const aktiv = aktivSesjon(kunde);
  const appLenke = useAppLenke();

  return (
    <div className="pf-kundehode">
      <div style={{ minWidth: 0 }}>
        <h1>{org.name}</h1>
        <div className="pf-chips">
          <span className={`pf-chip ${org.active ? "ok" : ""}`}>{org.active ? "Aktiv" : "Inaktiv"}</span>
          {org.demo && <span className="pf-chip demo">Demo</span>}
          {org.orgForm && <span className="pf-chip">{selskapsformNavn(org.orgForm)}</span>}
          {org.createdAt && <span className="pf-chip">Kunde siden {dato(org.createdAt)}</span>}
          {org.unitCount ? (
            <span className="pf-chip">
              {org.unitCount} {org.unitCount === 1 ? "andel" : "andeler"}
            </span>
          ) : null}
        </div>
      </div>
      <div className="pf-kundehode-handlinger">
        <button className="btn btn-ghost" onClick={onRediger}>
          Rediger
        </button>
        {aktiv ? (
          <a className="btn btn-primary" href={appLenke}>
            Til kundeappen
          </a>
        ) : (
          <button className="btn btn-primary" onClick={onSupport}>
            Support-modus
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Stripen mens support-modus er aktiv. Står over hodet på alle fanene: et pågående innsyn
 * man må lete etter, er et glemt innsyn.
 *
 * «Avslutt» lukker bare EGNE sesjoner (se `avsluttSupport`). Er det en kollega som har
 * innsyn, står navnet deres i stripen.
 */
export function SupportStripe({
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
  const [jobber, setJobber] = useState(false);
  const aktiv = aktivSesjon(kunde);
  if (!aktiv) return null;

  async function avslutt() {
    setJobber(true);
    onFeil(null);
    try {
      await api.slett(`/plattform/support?orgId=${orgId}`);
      await onEndret();
    } catch (e) {
      onFeil(e instanceof Error ? e.message : "Kunne ikke avslutte support-modus");
    } finally {
      setJobber(false);
    }
  }

  return (
    <div className="pf-support-stripe" role="status">
      <b>Support-modus aktiv</b>
      <span>
        {aktiv.adminName ? `${aktiv.adminName}. ` : ""}Utløper {datoTid(aktiv.expiresAt)}.
        Begrunnelse: «{aktiv.reason}»
      </span>
      <button className="btn btn-ghost" disabled={jobber} onClick={() => void avslutt()}>
        Avslutt
      </button>
    </div>
  );
}

/** Dialogen som starter support-modus. Reglene er uendret: begrunnelse, logg, 4 timer. */
export function SupportDialog({
  kunde,
  orgId,
  onLukk,
  onStartet,
}: {
  kunde: Kunde;
  orgId: string;
  onLukk: () => void;
  onStartet: () => void;
}) {
  const [grunn, setGrunn] = useState("");
  const { sender, feil, send } = useSending(onStartet);

  return (
    <Modal tittel="Start support-modus" onLukk={onLukk} bredde={520}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(() => api.send("/plattform/support", { orgId, reason: grunn.trim() }));
        }}
      >
        {feil && <div className="feilmelding">{feil}</div>}
        <p className="pf-tekst">
          Uten support-modus ser du bare kundeforholdet. Med support-modus ser du kundens
          oppgaver, avvik og beboerdata. Innsynet logges med begrunnelse og utløper automatisk
          etter {kunde.maksTimer} timer.
        </p>
        <Tekstfelt
          etikett="Begrunnelse"
          verdi={grunn}
          onEndre={setGrunn}
          notat="Hvorfor trenger du innsyn? For eksempel «Kunden melder feil i avvikslista»."
        />
        <Knapperad
          onAvbryt={onLukk}
          sendEtikett="Start support-modus"
          sender={sender}
          deaktivert={grunn.trim().length < 3}
        />
      </form>
    </Modal>
  );
}
