"use client";

import { useState } from "react";
import { useOkt } from "@/components/OktProvider";
import { Feil, Kort, Tom, dato, datoTid, useOrgData } from "@/components/felles";
import { Modal, Tekstfelt } from "@/components/skjema";
import { type EaseeAnlegg, easee } from "@/lib/klient";

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
              <span className="ea-fakta-et">Kobling</span>
              <div className="ea-fakta-v mut">av {k.connectedBy}</div>
              <div className="list-meta">{dato(k.createdAt)} · sist sjekket {k.lastCheckedAt ? datoTid(k.lastCheckedAt) : "aldri"}</div>
            </div>
          </div>
          {k.lastError && <div className="feilmelding">Siste kall mot Easee feilet: {k.lastError}</div>}
          <div className="field-note">
            Laderne kobles til parkeringsplasser i Parkering → Lading, der også tilstand,
            månedsrapport og prisplaner ligger. DriftIQ leser bare: den starter, stopper eller
            styrer aldri en lader, og endrer ingenting i Easee.
          </div>
          {erAdmin && (
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "flex-end" }}>
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
          hentAnlegg={(d) => easee.anlegg(orgId!, d).then((r) => r.anlegg)}
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

/**
 * Tilkoblingen i to steg: brukernavn og passord henter først anleggene kontoen når. Ett
 * anlegg kobles rett til; flere gir en dialog der styret velger. Passordet holdes i
 * skjemaet til valget er gjort — det sendes to ganger, men lagres aldri.
 */
function KobleTil({
  erAdmin,
  kryptering,
  jobber,
  hentAnlegg,
  onKoble,
}: {
  erAdmin: boolean;
  kryptering: boolean;
  jobber: boolean;
  hentAnlegg: (d: { userName: string; password: string }) => Promise<EaseeAnlegg[]>;
  onKoble: (d: { userName: string; password: string; siteId: number }) => Promise<void>;
}) {
  const [userName, setUserName] = useState("");
  const [password, setPassword] = useState("");
  const [henter, setHenter] = useState(false);
  const [feil, setFeil] = useState<string | null>(null);
  const [valg, setValg] = useState<EaseeAnlegg[] | null>(null);

  if (!erAdmin) return <Tom tekst="Easee-koblingen settes opp av kontoadmin." />;
  if (!kryptering) return <Tom tekst="Koblingen er ikke satt opp på serveren (mangler nøkkel for kryptering av hemmeligheter)." />;

  const konto = { userName: userName.trim(), password };

  async function start() {
    setFeil(null);
    setHenter(true);
    try {
      const anlegg = await hentAnlegg(konto);
      if (anlegg.length === 1) await onKoble({ ...konto, siteId: anlegg[0]!.id });
      else setValg(anlegg);
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Noe gikk galt");
    } finally {
      setHenter(false);
    }
  }

  const opptatt = jobber || henter;

  return (
    <form
      style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "14px" }}
      onSubmit={(e) => {
        e.preventDefault();
        void start();
      }}
    >
      <Feil melding={feil} />
      <div className="field-note">
        Se laderne i anlegget, hvem som står på hvilken plass, og strømforbruket per måned —
        rett i parkeringsmodulen. Logg inn med Easee-kontoen som er <b>site owner</b> for
        anlegget. Passordet brukes én gang for å hente en tilgangsnøkkel fra Easee og lagres
        aldri; nøkkelen lagres kryptert og fornyes automatisk. Når kontoen når flere anlegg,
        velger du hvilket etterpå.
      </div>
      <div className="field-row">
        <Tekstfelt etikett="Brukernavn i Easee" verdi={userName} onEndre={setUserName} plassholder="e-post eller +47 912 34 567" />
        <Tekstfelt etikett="Passord" verdi={password} onEndre={setPassword} type="password" />
      </div>
      <button className="btn btn-primary" style={{ alignSelf: "flex-start" }} disabled={opptatt || !userName.trim() || !password}>
        {opptatt ? "Kobler …" : "Koble til Easee"}
      </button>
      {valg && (
        <Modal tittel="Velg anlegg" onLukk={() => !jobber && setValg(null)} bredde={460}>
          <div className="field-note" style={{ marginBottom: "12px" }}>
            Kontoen når {valg.length} anlegg i Easee. Velg det laderne i dette borettslaget står i.
          </div>
          <div className="ea-anlegg-liste">
            {valg.map((a) => (
              <button
                key={a.id}
                type="button"
                className="ea-anlegg"
                disabled={jobber}
                onClick={() => void onKoble({ ...konto, siteId: a.id }).then(() => setValg(null))}
              >
                <b>{a.name}</b>
                <span className="list-meta">{a.adresse ? `${a.adresse} · ` : ""}id {a.id}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}
    </form>
  );
}
