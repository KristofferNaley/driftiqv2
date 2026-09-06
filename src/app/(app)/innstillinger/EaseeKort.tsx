"use client";

import { useState } from "react";
import { useOkt } from "@/components/OktProvider";
import { Feil, Kort, Tom, dato, datoTid, useOrgData } from "@/components/felles";
import { Tekstfelt } from "@/components/skjema";
import { easee } from "@/lib/klient";
import { belopFelt, kroner, tilOre } from "@/lib/okonomiregler";

/**
 * Easee-kortet under Innstillinger → Integrasjoner (docs/easee.md). Brukernavn og passord
 * for Easee-kontoen skrives inn én gang og byttes i tokener som lagres kryptert —
 * passordet lagres aldri; laderne kobles til plasser fra Lading-fanen i Parkering. Hele
 * integrasjonen er én fjernbar pakke — dette kortet er UI-delen av den, sammen med
 * `components/EaseeLading.tsx`.
 */
export default function EaseeKort() {
  const { aktivOrg } = useOkt();
  const erAdmin = aktivOrg?.nivaa === "orgadmin";
  const { data, feil, setFeil, laster, last, orgId } = useOrgData((o) => easee.status(o));
  const [melding, setMelding] = useState<string | null>(null);
  const [jobber, setJobber] = useState(false);
  const [pris, setPris] = useState<string | null>(null);

  async function utfor(fn: () => Promise<string | void>) {
    if (!orgId) return;
    setFeil(null);
    setMelding(null);
    setJobber(true);
    try {
      const m = await fn();
      if (m) setMelding(m);
      await last();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Noe gikk galt");
    } finally {
      setJobber(false);
    }
  }

  const k = data?.kobling ?? null;

  return (
    <Kort
      tittel="Easee — ladeanlegg"
      handling={
        data && (
          <span className={`badge ${k ? (k.lastError ? "danger" : "ok") : "muted"}`}>
            {k ? (k.lastError ? "Feil" : "Tilkoblet") : "Ikke tilkoblet"}
          </span>
        )
      }
    >
      <Feil melding={feil} />
      {melding && <div className="ea-melding">{melding}</div>}
      {laster || !data ? (
        <Tom tekst="Henter …" />
      ) : k ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "14px", padding: "14px" }}>
          <div className="ea-fakta">
            <div>
              <span className="ea-fakta-et">Anlegg i Easee</span>
              <div className="ea-fakta-v">{k.siteName}</div>
              <div className="list-meta">id {k.siteId} · konto {k.userName}</div>
            </div>
            <div>
              <span className="ea-fakta-et">Ladere</span>
              <div className="ea-fakta-v">{data.ladere.antall}</div>
              <div className="list-meta">{data.ladere.koblet} koblet til plass</div>
            </div>
            <div>
              <span className="ea-fakta-et">Strømpris</span>
              <div className="ea-fakta-v">{k.pricePerKwhOre === null ? "Ikke satt" : `${kroner(k.pricePerKwhOre, { alltidOre: true })}/kWh`}</div>
              <div className="list-meta">til avregningen i Lading-fanen</div>
            </div>
            <div>
              <span className="ea-fakta-et">Kobling</span>
              <div className="ea-fakta-v mut">av {k.connectedBy}</div>
              <div className="list-meta">{dato(k.createdAt)} · sist sjekket {k.lastCheckedAt ? datoTid(k.lastCheckedAt) : "aldri"}</div>
            </div>
          </div>
          {k.lastError && <div className="feilmelding">Siste kall mot Easee feilet: {k.lastError}</div>}
          <div className="field-note">
            Laderne kobles til parkeringsplasser i Parkering → Lading, der også tilstand og
            månedsforbruk vises. DriftIQ leser bare: den starter, stopper eller styrer aldri
            en lader, og endrer ingenting i Easee.
          </div>
          {erAdmin && (
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "flex-end" }}>
              {pris === null ? (
                <button className="btn btn-ghost" disabled={jobber} onClick={() => setPris(belopFelt(k.pricePerKwhOre))}>
                  {k.pricePerKwhOre === null ? "Sett strømpris" : "Endre strømpris"}
                </button>
              ) : (
                <form
                  style={{ display: "flex", gap: "8px", alignItems: "flex-end", flexWrap: "wrap" }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const ore = pris.trim() === "" ? null : tilOre(pris);
                    if (pris.trim() !== "" && ore === null) {
                      setFeil("Skriv prisen i kroner per kWh, f.eks. 1,85");
                      return;
                    }
                    void utfor(async () => {
                      await easee.settPris(orgId!, ore);
                      setPris(null);
                      return ore === null ? "Strømprisen er fjernet." : "Strømprisen er lagret.";
                    });
                  }}
                >
                  <Tekstfelt etikett="Kr per kWh" verdi={pris} onEndre={setPris} plassholder="1,85" notat="Tom = bare kWh vises" />
                  <button className="btn btn-primary" disabled={jobber}>Lagre</button>
                  <button type="button" className="btn btn-ghost" onClick={() => setPris(null)}>Avbryt</button>
                </form>
              )}
              <button
                className="btn btn-ghost"
                disabled={jobber}
                onClick={() =>
                  window.confirm("Koble fra Easee? Laderne, plasskoblingene og forbrukshistorikken beholdes, men oppdateres ikke lenger.") &&
                  void utfor(async () => {
                    await easee.kobleFra(orgId!);
                    return "Koblet fra Easee.";
                  })
                }
              >
                Koble fra
              </button>
            </div>
          )}
        </div>
      ) : (
        <KobleTil
          erAdmin={erAdmin}
          kryptering={data.konfigurert.kryptering}
          jobber={jobber}
          onKoble={(d) =>
            utfor(async () => {
              await easee.kobleTil(orgId!, d);
              return "Koblet til Easee. Koble laderne til plasser i Parkering → Lading.";
            })
          }
        />
      )}
    </Kort>
  );
}

function KobleTil({
  erAdmin,
  kryptering,
  jobber,
  onKoble,
}: {
  erAdmin: boolean;
  kryptering: boolean;
  jobber: boolean;
  onKoble: (d: { userName: string; password: string; siteId: number | null }) => Promise<void>;
}) {
  const [userName, setUserName] = useState("");
  const [password, setPassword] = useState("");
  const [siteId, setSiteId] = useState("");

  if (!erAdmin) return <Tom tekst="Easee-koblingen settes opp av kontoadmin." />;
  if (!kryptering) return <Tom tekst="Koblingen er ikke satt opp på serveren (mangler nøkkel for kryptering av hemmeligheter)." />;

  return (
    <form
      style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "14px" }}
      onSubmit={(e) => {
        e.preventDefault();
        const id = siteId.trim() ? Number(siteId.trim()) : null;
        void onKoble({ userName: userName.trim(), password, siteId: id && Number.isInteger(id) ? id : null });
      }}
    >
      <div className="field-note">
        Se laderne i anlegget, hvem som står på hvilken plass, og strømforbruket per måned —
        rett i parkeringsmodulen. Logg inn med Easee-kontoen som er <b>site owner</b> for
        anlegget. Passordet brukes én gang for å hente en tilgangsnøkkel fra Easee og lagres
        aldri; nøkkelen lagres kryptert og fornyes automatisk.
      </div>
      <div className="field-row">
        <Tekstfelt etikett="Brukernavn i Easee" verdi={userName} onEndre={setUserName} plassholder="e-post eller +47 912 34 567" />
        <Tekstfelt etikett="Passord" verdi={password} onEndre={setPassword} type="password" />
      </div>
      <Tekstfelt
        etikett="Anlegg-id"
        verdi={siteId}
        onEndre={setSiteId}
        notat="Tom = det ene anlegget nøkkelen når. Når flere, sier feilmeldingen hvilke som finnes."
      />
      <button className="btn btn-primary" style={{ alignSelf: "flex-start" }} disabled={jobber || !userName.trim() || !password}>
        {jobber ? "Kobler …" : "Koble til Easee"}
      </button>
    </form>
  );
}
