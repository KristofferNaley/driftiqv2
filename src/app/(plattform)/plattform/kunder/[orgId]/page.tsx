"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Ramme } from "../../ramme";
import { datoTid } from "@/components/felles";
import { api } from "@/lib/klient";
import { ALLE_MODULER, MENY, modulErAktivert } from "@/lib/moduler";
import { NIVA_ETIKETT } from "@/lib/nivaer";

type Kunde = {
  id: string;
  name: string;
  orgNr: string | null;
  orgForm: string | null;
  municipality: string | null;
  unitCount: number | null;
  active: boolean;
  enabledModules: string | null;
  antallOppgaver: number;
  antallAvvik: number;
  maksTimer: number;
  brukere: Array<{ id: string; navn: string; epost: string; nivaa: string; sistInnlogget: string | null }>;
  sesjoner: Array<{
    id: string;
    adminName: string | null;
    reason: string;
    startedAt: string;
    expiresAt: string | null;
    endedAt: string | null;
  }>;
};

export default function Kundedetalj({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = use(params);
  const [kunde, setKunde] = useState<Kunde | null>(null);
  const [feil, setFeil] = useState<string | null>(null);
  const [grunn, setGrunn] = useState("");
  const [jobber, setJobber] = useState(false);

  const last = useCallback(async () => {
    try {
      setKunde(await api.hent<Kunde>(`/plattform/kunder/${orgId}`));
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke hente kunden");
    }
  }, [orgId]);

  useEffect(() => {
    void last();
  }, [last]);

  if (!kunde) {
    return (
      <Ramme tittel="Kunde">
        {feil ? <div className="feilmelding">{feil}</div> : <p className="pf-dempet">Henter …</p>}
      </Ramme>
    );
  }

  const aktiv = kunde.sesjoner.find(
    (s) => !s.endedAt && s.expiresAt && new Date(s.expiresAt) > new Date(),
  );

  async function start() {
    setJobber(true);
    setFeil(null);
    try {
      await api.send("/plattform/support", { orgId, reason: grunn.trim() });
      setGrunn("");
      await last();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke starte support-modus");
    } finally {
      setJobber(false);
    }
  }

  async function avslutt() {
    setJobber(true);
    setFeil(null);
    try {
      await api.slett(`/plattform/support?orgId=${orgId}`);
      await last();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke avslutte support-modus");
    } finally {
      setJobber(false);
    }
  }

  const moduler = ALLE_MODULER.filter((n) => MENY[n] && modulErAktivert(kunde.enabledModules, n));

  return (
    <Ramme tittel={kunde.name}>
      <Link href="/plattform" className="tilbake-lenke">← Alle kunder</Link>
      {feil && <div className="feilmelding">{feil}</div>}

      {/* ── SUPPORT-MODUS ──
          Øverst med vilje: dette er den mest inngripende handlingen i panelet, og den skal
          ikke ligge nederst der man scroller forbi den. */}
      <div className={`pf-kort support${aktiv ? " aktiv" : ""}`}>
        <div className="pf-kort-hode">
          <span>Support-modus</span>
          {aktiv && <span className="badge warn">Aktiv</span>}
        </div>
        <div className="pf-kort-kropp">
          {aktiv ? (
            <>
              <p className="pf-tekst">
                Du har innsyn i denne kundens data til{" "}
                <b>{datoTid(aktiv.expiresAt)}</b>. Begrunnelse: «{aktiv.reason}»
              </p>
              <button className="btn btn-ghost fjern-knapp" disabled={jobber} onClick={() => void avslutt()}>
                Avslutt support-modus
              </button>
            </>
          ) : (
            <>
              <p className="pf-tekst">
                Uten support-modus har du <b>ingen</b> tilgang til kundens oppgaver, avvik
                eller beboerdata — panelet viser bare kundeforholdet. Innsynet logges med
                begrunnelse og utløper automatisk etter {kunde.maksTimer} timer.
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
                  onClick={() => void start()}
                >
                  Start support-modus
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="pf-grid">
        <div className="pf-kort">
          <div className="pf-kort-hode"><span>Kundeforhold</span></div>
          <div className="pf-kort-kropp">
            <Felt etikett="Organisasjonsnummer" verdi={kunde.orgNr ?? "—"} />
            <Felt etikett="Organisasjonsform" verdi={kunde.orgForm ?? "—"} />
            <Felt etikett="Kommune" verdi={kunde.municipality ?? "—"} />
            <Felt etikett="Antall enheter" verdi={String(kunde.unitCount ?? "—")} />
            <Felt etikett="Status" verdi={kunde.active ? "Aktiv" : "Inaktiv"} />
            <Felt etikett="Oppgaver" verdi={String(kunde.antallOppgaver)} />
            <Felt etikett="Avvik" verdi={String(kunde.antallAvvik)} />
          </div>
        </div>

        <div className="pf-kort">
          <div className="pf-kort-hode"><span>Moduler ({moduler.length})</span></div>
          <div className="pf-kort-kropp">
            {moduler.map((n) => (
              <div key={n} className="pf-modul">
                <span>{MENY[n]!.etikett}</span>
                <span className="pf-under">{MENY[n]!.gruppe}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="pf-kort">
        <div className="pf-kort-hode"><span>Brukere ({kunde.brukere.length})</span></div>
        <div className="pf-kort-kropp">
          {kunde.brukere.map((b) => (
            <div key={b.id} className="pf-bruker">
              <span style={{ minWidth: 0 }}>
                <span className="pf-navn">{b.navn}</span>
                <span className="pf-under">{b.epost}</span>
              </span>
              <span className="pf-celle">{NIVA_ETIKETT[b.nivaa] ?? b.nivaa}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Innsynsloggen står i PANELET, ikke bare i databasen. En logg ingen ser på er ikke
          en kontroll, den er en formalitet. */}
      <div className="pf-kort">
        <div className="pf-kort-hode"><span>Innsynslogg</span></div>
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
    </Ramme>
  );
}

function Felt({ etikett, verdi }: { etikett: string; verdi: string }) {
  return (
    <div className="pf-felt">
      <span className="pf-under">{etikett}</span>
      <span>{verdi}</span>
    </div>
  );
}
