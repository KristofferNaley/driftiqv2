"use client";

import { useState } from "react";
import { useOkt } from "@/components/OktProvider";
import { Feil, Kort, Tom, dato, datoTid, useOrgData } from "@/components/felles";
import { Tekstfelt } from "@/components/skjema";
import { unloc } from "@/lib/klient";

/**
 * Unloc-kortet under Innstillinger → Integrasjoner (docs/unloc.md). Credentials skrives
 * inn én gang, verifiseres mot Unloc og lagres kryptert; selve nøklene deles ut fra
 * leverandørkortet. Hele integrasjonen er én fjernbar pakke — dette kortet er UI-delen
 * av den, sammen med `components/UnlocNokler.tsx`.
 */
export default function UnlocKort() {
  const { aktivOrg } = useOkt();
  const erAdmin = aktivOrg?.nivaa === "orgadmin";
  const { data, feil, setFeil, laster, last, orgId } = useOrgData((o) => unloc.status(o));
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
      tittel="Unloc — digitale nøkler"
      handling={
        data && (
          <span className={`badge ${k ? (k.lastError ? "danger" : "ok") : "muted"}`}>
            {k ? (k.lastError ? "Feil" : "Tilkoblet") : "Ikke tilkoblet"}
          </span>
        )
      }
    >
      <Feil melding={feil} />
      {melding && <div className="un-melding">{melding}</div>}
      {laster || !data ? (
        <Tom tekst="Henter …" />
      ) : k ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "14px", padding: "14px" }}>
          <div className="un-fakta">
            <div>
              <span className="un-fakta-et">Prosjekt i Unloc</span>
              <div className="un-fakta-v">{k.projectName}</div>
              <div className="list-meta">{k.projectId}</div>
            </div>
            <div>
              <span className="un-fakta-et">Aktive nøkler</span>
              <div className="un-fakta-v">{data.nokler.aktive}</div>
              <div className="list-meta">delt ut fra leverandørkortene</div>
            </div>
            <div>
              <span className="un-fakta-et">Kobling</span>
              <div className="un-fakta-v mut">av {k.connectedBy}</div>
              <div className="list-meta">{dato(k.createdAt)} · sist sjekket {k.lastCheckedAt ? datoTid(k.lastCheckedAt) : "aldri"}</div>
            </div>
          </div>
          {k.lastError && <div className="feilmelding">Siste kall mot Unloc feilet: {k.lastError}</div>}
          <div className="field-note">
            Nøkler deles ut og kalles tilbake fra fanen «Digitale nøkler» på hver leverandør. Hver utdeling
            lagres med hvem i styret som ga den, og føres i hendelsesloggen. DriftIQ rører aldri låser eller
            andre nøkler i Unloc enn dem den selv har delt ut.
          </div>
          {erAdmin && (
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button
                className="btn btn-ghost"
                disabled={jobber}
                onClick={() =>
                  window.confirm(
                    data.nokler.aktive > 0
                      ? `Koble fra Unloc? ${data.nokler.aktive} aktive nøkler blir stående i Unloc og kan ikke lenger kalles tilbake herfra — kall dem tilbake først hvis de skal bort.`
                      : "Koble fra Unloc? Historikken over utdelte nøkler beholdes.",
                  ) &&
                  void utfor(async () => {
                    await unloc.kobleFra(orgId!);
                    return "Koblet fra Unloc.";
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
              await unloc.kobleTil(orgId!, d);
              return "Koblet til Unloc. Nøkler deles ut fra leverandørkortet.";
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
  onKoble: (d: { clientId: string; clientSecret: string; projectId: string | null }) => Promise<void>;
}) {
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [projectId, setProjectId] = useState("");

  if (!erAdmin) return <Tom tekst="Unloc-koblingen settes opp av kontoadmin." />;
  if (!kryptering) return <Tom tekst="Koblingen er ikke satt opp på serveren (mangler nøkkel for kryptering av hemmeligheter)." />;

  return (
    <form
      style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "14px" }}
      onSubmit={(e) => {
        e.preventDefault();
        void onKoble({ clientId: clientId.trim(), clientSecret: secret.trim(), projectId: projectId.trim() || null });
      }}
    >
      <div className="field-note">
        Del ut digitale nøkler til håndverkere og leverandører rett fra leverandørkortet. Krever at laget har
        API-credentials hos Unloc (bestilles fra Unloc eller boligbyggelaget som forvalter låsene). Hemmeligheten
        lagres kryptert og vises aldri igjen.
      </div>
      <div className="field-row">
        <Tekstfelt etikett="Client id" verdi={clientId} onEndre={setClientId} plassholder="b0bf99dd-…" />
        <Tekstfelt etikett="Client secret" verdi={secret} onEndre={setSecret} type="password" />
      </div>
      <Tekstfelt
        etikett="Prosjekt-id"
        verdi={projectId}
        onEndre={setProjectId}
        notat="Tom = det ene prosjektet credentials når. Når flere, sier feilmeldingen hvilke som finnes."
      />
      <button className="btn btn-primary" style={{ alignSelf: "flex-start" }} disabled={jobber || !clientId.trim() || !secret.trim()}>
        {jobber ? "Kobler …" : "Koble til Unloc"}
      </button>
    </form>
  );
}
