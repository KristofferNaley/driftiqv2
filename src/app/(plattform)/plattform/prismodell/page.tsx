"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/klient";
import { MENY, TILLEGGSMODULER } from "@/lib/moduler";
import {
  grunnpakke,
  grunnpakkeSpesifisert,
  kroner,
  type Trinn,
} from "@/lib/prisregler";
import { Ramme } from "../ramme";

/**
 * Den GLOBALE prismodellen — ikke knyttet til én kunde.
 *
 * Den enkelte kundens abonnement redigeres på Fakturering-fanen i kundedetaljen, som bruker
 * modellen herfra til å regne ut grunnprisen automatisk fra antall andeler.
 */

type Prismodell = {
  gulvpris: number;
  trinn: Trinn[];
  modulpriser: Record<string, number>;
  skjulteModuler: string[];
  varselmottakere: string[];
};

export default function Prismodellsiden() {
  const [modell, setModell] = useState<Prismodell | null>(null);
  const [feil, setFeil] = useState<string | null>(null);

  useEffect(() => {
    api
      .hent<Prismodell>("/plattform/prismodell")
      .then(setModell)
      .catch((e) => setFeil(e instanceof Error ? e.message : "Kunne ikke hente prismodellen"));
  }, []);

  return (
    <Ramme tittel="Prismodell">
      {feil && <div className="feilmelding">{feil}</div>}
      {!modell ? (
        <p className="pf-dempet">Henter …</p>
      ) : (
        <Skjema modell={modell} onLagret={setModell} />
      )}
    </Ramme>
  );
}

function Skjema({
  modell,
  onLagret,
}: {
  modell: Prismodell;
  onLagret: (m: Prismodell) => void;
}) {
  const [gulvpris, setGulvpris] = useState(modell.gulvpris);
  const [trinn, setTrinn] = useState<Trinn[]>(modell.trinn);
  const [modulpriser, setModulpriser] = useState(modell.modulpriser);
  // 150 andeler treffer tre trinn med standardmodellen — et tall som faktisk viser at
  // modellen er degressiv. En tom eller liten verdi hadde vist én linje og forklart lite.
  const [simAndeler, setSimAndeler] = useState(150);
  const [lagrer, setLagrer] = useState(false);
  const [feil, setFeil] = useState<string | null>(null);

  const linjer = grunnpakkeSpesifisert(simAndeler, trinn);
  const sum = grunnpakke(simAndeler, gulvpris, trinn);
  // Gulvet er verdt å si fra om: uten det ser et lite lag ut som en regnefeil.
  const gulvSlarInn = linjer.reduce((n, l) => n + l.sum, 0) < gulvpris;

  function endreTrinn(i: number, felt: keyof Trinn, verdi: string) {
    const n = parseInt(verdi, 10);
    setTrinn(trinn.map((t, j) => (j === i ? { ...t, [felt]: Number.isFinite(n) ? n : 0 } : t)));
  }

  function nyttTrinn() {
    const siste = trinn[trinn.length - 1];
    const fra = (siste?.til ?? 0) + 1;
    setTrinn([...trinn, { fra, til: fra + 99, sats: 50 }]);
  }

  async function lagre() {
    setLagrer(true);
    setFeil(null);
    try {
      const oppdatert = await api.endre<Prismodell>("/plattform/prismodell", {
        gulvpris,
        trinn,
        modulpriser,
        // Uendret herfra — hvilke moduler som er skjult styres på Moduler-fanen i
        // kundedetaljen, ikke i prismodellen.
        skjulteModuler: modell.skjulteModuler,
      });
      onLagret(oppdatert);
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke lagre prismodellen");
    } finally {
      setLagrer(false);
    }
  }

  return (
    <>
      {feil && <div className="feilmelding">{feil}</div>}

      <div className="pf-kort">
        <div className="pf-kort-hode">
          <span>Grunnpakke</span>
          <button className="btn btn-primary" onClick={() => void lagre()} disabled={lagrer}>
            {lagrer ? "Lagrer …" : "Lagre prismodell"}
          </button>
        </div>

        <div className="pf-felt-rad">
          <label className="field-label" htmlFor="gulv">
            Gulvpris
          </label>
          <input
            id="gulv"
            className="input"
            type="number"
            min={0}
            style={{ maxWidth: "160px" }}
            value={gulvpris}
            onChange={(e) => setGulvpris(parseInt(e.target.value, 10) || 0)}
          />
          <span className="pf-dempet">
            Laveste årspris uansett størrelse. Et lite sameie koster like mye å drifte som et
            stort i alt annet enn andeler.
          </span>
        </div>

        <div className="pf-trinn-hode">
          <span>Fra andel</span>
          <span>Til andel</span>
          <span>Sats per andel</span>
          <span />
        </div>
        {trinn.map((t, i) => (
          <div key={i} className="pf-trinn-rad">
            <input
              className="input"
              type="number"
              aria-label={`Trinn ${i + 1}, fra andel`}
              value={t.fra}
              onChange={(e) => endreTrinn(i, "fra", e.target.value)}
            />
            <input
              className="input"
              type="number"
              aria-label={`Trinn ${i + 1}, til andel`}
              value={t.til}
              onChange={(e) => endreTrinn(i, "til", e.target.value)}
            />
            <input
              className="input"
              type="number"
              aria-label={`Trinn ${i + 1}, sats`}
              value={t.sats}
              onChange={(e) => endreTrinn(i, "sats", e.target.value)}
            />
            <button
              className="btn btn-ghost"
              onClick={() => setTrinn(trinn.filter((_, j) => j !== i))}
              // Modellen må ha minst ett trinn — API-et avviser en tom liste, og en
              // knapp som alltid feiler er verre enn en som er av.
              disabled={trinn.length === 1}
              title={trinn.length === 1 ? "Modellen må ha minst ett trinn" : "Fjern trinnet"}
            >
              Fjern
            </button>
          </div>
        ))}
        <div className="pf-trinn-rad">
          <button className="btn btn-ghost" onClick={nyttTrinn}>
            ＋ Nytt trinn
          </button>
        </div>

        <p className="field-note" style={{ padding: "0 16px 14px" }}>
          Modellen er degressiv: hvert trinn gjelder kun andelene innenfor sitt eget
          intervall. Et lag med 200 andeler betaler altså full sats for de første 50, ikke
          laveste sats for alle 200.
        </p>
      </div>

      <div className="pf-kort">
        <div className="pf-kort-hode">
          <span>Regn ut</span>
        </div>
        <div className="pf-felt-rad">
          <label className="field-label" htmlFor="sim">
            Antall andeler
          </label>
          <input
            id="sim"
            className="input"
            type="number"
            min={0}
            style={{ maxWidth: "160px" }}
            value={simAndeler}
            onChange={(e) => setSimAndeler(parseInt(e.target.value, 10) || 0)}
          />
        </div>
        {linjer.map((l, i) => (
          <div key={i} className="pf-rad">
            <span>
              Andel {l.fra}–{Math.min(simAndeler, l.til)}
            </span>
            <span className="pf-dempet">
              {l.andelerITrinnet} × {kroner(l.sats)}
            </span>
            <span className="pf-tall">{kroner(l.sum)}</span>
          </div>
        ))}
        {gulvSlarInn && (
          <div className="pf-rad">
            <span className="pf-dempet">Gulvprisen slår inn</span>
            <span />
            <span className="pf-tall pf-dempet">{kroner(gulvpris)}</span>
          </div>
        )}
        <div className="pf-rad sum">
          <span>Grunnpakke per år</span>
          <span />
          <span className="pf-tall">{kroner(sum)}</span>
        </div>
      </div>

      <div className="pf-kort">
        <div className="pf-kort-hode">
          <span>Tilleggsmoduler — standardpris</span>
        </div>
        <p className="field-note" style={{ padding: "0 16px 6px" }}>
          Utgangspunktet når en kunde får modulen lagt til. Prisen kan overstyres per kunde
          på Fakturering-fanen.
        </p>
        {TILLEGGSMODULER.map((n) => {
          const skjult = modell.skjulteModuler.includes(n);
          return (
            <div key={n} className="pf-rad">
              <span>
                {MENY[n]?.etikett ?? n}
                {/* En skjult modul kan ikke selges — da er prisen bare støy. */}
                {skjult && <span className="pf-merkelapp"> Skjult</span>}
              </span>
              <span />
              <input
                className="input"
                type="number"
                min={0}
                aria-label={`Årspris for ${MENY[n]?.etikett ?? n}`}
                style={{ maxWidth: "140px" }}
                disabled={skjult}
                value={modulpriser[n] ?? 0}
                onChange={(e) =>
                  setModulpriser({ ...modulpriser, [n]: parseInt(e.target.value, 10) || 0 })
                }
              />
            </div>
          );
        })}
      </div>
    </>
  );
}
