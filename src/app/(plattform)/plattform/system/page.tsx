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
  jobb: { tidspunkt: string; tidssone: string };
};

export default function System() {
  const [helse, setHelse] = useState<Helse | null>(null);
  const [feil, setFeil] = useState<string | null>(null);

  useEffect(() => {
    api
      .hent<Helse>("/plattform/system")
      .then(setHelse)
      .catch((e) => setFeil(e instanceof Error ? e.message : "Kunne ikke hente systemstatus"));
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
        <div className="pf-kort-kropp">
          <Felt
            etikett="Varselsjobb"
            verdi={`Hver dag kl. ${helse.jobb.tidspunkt} (${helse.jobb.tidssone})`}
          />
        </div>
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
