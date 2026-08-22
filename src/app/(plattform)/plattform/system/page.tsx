"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/klient";
import { Ramme } from "../ramme";

/**
 * Systemhelse.
 *
 * Det viktigste kortet er RLS: det svarer på om tenantisolasjonen faktisk er i kraft akkurat
 * nå, spurt mot databasen — ikke lest fra en konfigurasjonsverdi som ble satt ved oppstart.
 */

type Innlogging = {
  id: string; userId: string | null; email: string;
  event: "innlogget" | "feilet" | "avvist" | "utlogget"; ip: string | null; occurredAt: string;
};

type Helse = {
  database: {
    navn: string;
    rolle: string;
    erApprolle: boolean;
    storrelseMb: number;
    versjon: string;
  };
  rls: { antallTabeller: number; mangler: string[] };
  kjoretid: { node: string; next: string; oppetid: string; minneMb: number };
  vert: { oppetid: string; minneBruktMb: number; minneTotaltMb: number; last: number };
  disk: { totaltGb: number; bruktGb: number; prosent: number } | null;
  jobber: Array<{
    nokkel: string; navn: string; beskrivelse: string; plan: string;
    kilde: "app" | "vert"; logg: string | null; neste: string | null;
    siste: { naar: string; ok: boolean; detail: string | null } | null;
  }>;
};

const NAAR: Intl.DateTimeFormatOptions = {
  weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
};

export default function System() {
  const [helse, setHelse] = useState<Helse | null>(null);
  const [innlogginger, setInnlogginger] = useState<Innlogging[]>([]);
  const [feil, setFeil] = useState<string | null>(null);

  useEffect(() => {
    api
      .hent<Helse>("/plattform/system")
      .then(setHelse)
      .catch((e) => setFeil(e instanceof Error ? e.message : "Kunne ikke hente systemstatus"));
    // Innloggingsloggen er sitt eget kall — feiler den, skal helsekortene fortsatt vises.
    api.hent<Innlogging[]>("/plattform/innlogginger").then(setInnlogginger).catch(() => {});
  }, []);

  if (!helse) {
    return (
      <Ramme tittel="System">
        {feil ? <div className="feilmelding">{feil}</div> : <p className="pf-dempet">Henter …</p>}
      </Ramme>
    );
  }

  const rlsOk = helse.rls.mangler.length === 0 && helse.database.erApprolle;

  return (
    <Ramme tittel="System">
      <div className={`pf-kort${rlsOk ? "" : " support aktiv"}`}>
        <div className="pf-kort-hode">
          <span>Tenantisolasjon (RLS)</span>
          <span className={`pf-merkelapp ${rlsOk ? "aktiv" : "varsel"}`}>
            {rlsOk ? "I kraft" : "Se over"}
          </span>
        </div>
        <div className="pf-kort-kropp">
          <Felt
            etikett="Tilkoblet som"
            verdi={helse.database.rolle}
            advarsel={!helse.database.erApprolle}
          />
          {!helse.database.erApprolle && (
            <p className="pf-tekst">
              Appen kobler til som noe annet enn approllen. Er det databaseeieren, omgås
              policyene og all tenantisolasjon er ute av kraft.
            </p>
          )}
          <Felt
            etikett="Tabeller med tvungen policy"
            verdi={`${helse.rls.antallTabeller - helse.rls.mangler.length} av ${helse.rls.antallTabeller}`}
            advarsel={helse.rls.mangler.length > 0}
          />
          {helse.rls.mangler.length > 0 && (
            <p className="pf-tekst">Mangler: {helse.rls.mangler.join(", ")}</p>
          )}
        </div>
      </div>

      <div className="pf-grid">
        <div className="pf-kort">
          <div className="pf-kort-hode">
            <span>Database</span>
          </div>
          <div className="pf-kort-kropp">
            <Felt etikett="Navn" verdi={helse.database.navn} />
            <Felt etikett="Versjon" verdi={helse.database.versjon} />
            <Felt etikett="Størrelse" verdi={`${helse.database.storrelseMb} MB`} />
          </div>
        </div>

        <div className="pf-kort">
          <div className="pf-kort-hode">
            <span>Appen</span>
          </div>
          <div className="pf-kort-kropp">
            <Felt etikett="Next.js" verdi={helse.kjoretid.next} />
            <Felt etikett="Node" verdi={helse.kjoretid.node} />
            {/* Oppetid for APPEN, ikke verten — det er appen som restartes ved deploy. */}
            <Felt etikett="Oppe siden deploy" verdi={helse.kjoretid.oppetid} />
            <Felt etikett="Minnebruk" verdi={`${helse.kjoretid.minneMb} MB`} />
          </div>
        </div>

        <div className="pf-kort">
          <div className="pf-kort-hode">
            <span>Verten</span>
          </div>
          <div className="pf-kort-kropp">
            <Felt etikett="Oppetid" verdi={helse.vert.oppetid} />
            <Felt
              etikett="Minne"
              verdi={`${helse.vert.minneBruktMb} / ${helse.vert.minneTotaltMb} MB`}
            />
            <Felt
              etikett="Last (per kjerne)"
              verdi={helse.vert.last.toFixed(2)}
              advarsel={helse.vert.last > 1}
            />
            {helse.disk && (
              <Felt
                etikett="Disk"
                verdi={`${helse.disk.bruktGb} / ${helse.disk.totaltGb} GB (${helse.disk.prosent} %)`}
                advarsel={helse.disk.prosent > 85}
              />
            )}
          </div>
        </div>
      </div>

      <div className="pf-kort">
        <div className="pf-kort-hode">
          <span>Bakgrunnsjobber</span>
        </div>
        {/* Alle jobbene — appens egne (med logget kjøringsstatus) og vertens crontab
            (status leses i loggfilene på verten; registeret i lib/jobber.ts dokumenterer dem). */}
        {helse.jobber.map((j) => (
          <div
            key={j.nokkel}
            className="pf-kort-kropp"
            style={{ borderTop: "1px solid var(--border)", display: "flex", gap: "14px", alignItems: "baseline", flexWrap: "wrap" }}
          >
            <div style={{ flex: 1, minWidth: "220px" }}>
              <div>{j.navn} <span className="badge muted">{j.kilde === "app" ? "appen" : "verten"}</span></div>
              <div className="field-note">{j.beskrivelse}</div>
            </div>
            <div style={{ minWidth: "170px" }}>
              <div>{j.plan}</div>
              {j.neste && (
                <div className="field-note">
                  neste {new Date(j.neste).toLocaleString("nb-NO", NAAR)}
                </div>
              )}
            </div>
            <div style={{ minWidth: "180px", textAlign: "right" }}>
              {j.siste ? (
                <>
                  <span className={`badge ${j.siste.ok ? "ok" : "danger"}`}>
                    {j.siste.ok ? "OK" : "Feilet"}
                  </span>
                  <div className="field-note" title={j.siste.detail ?? undefined}>
                    sist {new Date(j.siste.naar).toLocaleString("nb-NO", NAAR)}
                  </div>
                </>
              ) : j.kilde === "vert" ? (
                <div className="field-note">status i {j.logg} på verten</div>
              ) : (
                <div className="field-note">ingen kjøringer logget ennå</div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="pf-kort">
        <div className="pf-kort-hode">
          <span>Siste innlogginger</span>
        </div>
        {/* auth_events — brukernivå, derfor her og aldri i kunde-appen. Ryddes etter 90 dager. */}
        {innlogginger.length === 0 ? (
          <div className="pf-kort-kropp">
            <p className="pf-dempet">Ingen innloggingshendelser registrert ennå.</p>
          </div>
        ) : (
          innlogginger.map((i) => (
            <div
              key={i.id}
              className="pf-kort-kropp"
              style={{ borderTop: "1px solid var(--border)", display: "flex", gap: "14px", alignItems: "baseline", flexWrap: "wrap" }}
            >
              <div style={{ flex: 1, minWidth: "220px" }}>{i.email}</div>
              <span className={`badge ${i.event === "innlogget" ? "ok" : i.event === "utlogget" ? "muted" : "danger"}`}>
                {i.event}
              </span>
              <div style={{ minWidth: "180px", textAlign: "right" }}>
                <div>{new Date(i.occurredAt).toLocaleString("nb-NO", NAAR)}</div>
                {i.ip && <div className="field-note">{i.ip}</div>}
              </div>
            </div>
          ))
        )}
      </div>

      <p className="field-note">
        Det er ingen forespørselslogg her, i motsetning til i v1. Next.js kjører rutene i
        flere kontekster, og en logg i minnet ville vist et tilfeldig utvalg av trafikken —
        verre enn ingen logg, fordi den ser ut som hele bildet.
      </p>
    </Ramme>
  );
}

function Felt({
  etikett,
  verdi,
  advarsel,
}: {
  etikett: string;
  verdi: string;
  advarsel?: boolean;
}) {
  return (
    <div className="pf-felt">
      <span className="pf-under">{etikett}</span>
      <span className={advarsel ? "pf-advarsel" : undefined}>{verdi}</span>
    </div>
  );
}
