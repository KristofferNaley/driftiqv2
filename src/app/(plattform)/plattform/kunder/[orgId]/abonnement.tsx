"use client";

import { useState } from "react";
import { dato } from "@/components/felles";
import { Knapperad, Modal, Tekstfelt, Tekstomrade, useSending } from "@/components/skjema";
import { api } from "@/lib/klient";
import { ALLE_MODULER, ALLTID_PA, MENY, TILLEGGSMODULER } from "@/lib/moduler";
import { arssum, grunnpakke, kroner } from "@/lib/prisregler";
import { Felt, type Abonnement, type Detalj } from "./deler";

/** Fanen «Abonnement»: modulvalget og avtalen. Prislogikken er uendret fra før fanene. */

export function ModulFane({
  detalj,
  orgId,
  onEndret,
}: {
  detalj: Detalj;
  orgId: string;
  onEndret: () => Promise<void>;
}) {
  const [valgte, setValgte] = useState<string[]>(detalj.moduler);
  const [lagrer, setLagrer] = useState(false);
  const [feil, setFeil] = useState<string | null>(null);

  const endret =
    valgte.length !== detalj.moduler.length || valgte.some((n) => !detalj.moduler.includes(n));

  async function lagre() {
    setLagrer(true);
    setFeil(null);
    try {
      await api.endre(`/plattform/kunder/${orgId}/moduler`, { moduler: valgte });
      await onEndret();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke lagre modulvalget");
    } finally {
      setLagrer(false);
    }
  }

  // Listeprisen for VALGET slik det står nå — den som lagrer skal se hva det betyr for
  // neste faktura før de trykker, ikke etter.
  const listepris =
    detalj.grunnpakkeNaa +
    valgte
      .filter((n) => TILLEGGSMODULER.includes(n as (typeof TILLEGGSMODULER)[number]))
      .reduce((sum, n) => sum + (detalj.prismodell.modulpriser[n] ?? 0), 0);

  // Gruppene fra menyen — samme inndeling som kunden ser i sidemenyen sin.
  const grupper = new Map<string, typeof ALLE_MODULER[number][]>();
  for (const n of ALLE_MODULER) {
    const meny = MENY[n];
    if (!meny) continue;
    if (!grupper.has(meny.gruppe)) grupper.set(meny.gruppe, []);
    grupper.get(meny.gruppe)!.push(n);
  }

  return (
    <div className="pf-kort">
      <div className="pf-kort-hode">
        <span>Moduler og pris</span>
        <button className="btn btn-primary" disabled={!endret || lagrer} onClick={() => void lagre()}>
          {lagrer ? "Lagrer …" : "Lagre modulvalg"}
        </button>
      </div>
      {feil && <div className="feilmelding">{feil}</div>}

      {[...grupper.entries()].map(([gruppe, moduler]) => (
        <div key={gruppe}>
          <div className="pf-modulgruppe">{gruppe}</div>
          {moduler.map((n) => {
            const alltidPa = ALLTID_PA.has(n);
            // Én etikett for alt uten pris: «Inkludert», også for en tilleggsmodul som står
            // til 0 kr i prismodellen (før: «0 kr/år» ved siden av «Inkludert»).
            const pris = TILLEGGSMODULER.includes(n as (typeof TILLEGGSMODULER)[number])
              ? (detalj.prismodell.modulpriser[n] ?? 0)
              : 0;
            return (
              <label key={n} className="pf-modul-valg">
                {/* Sjekkboks i semantikken, bryter i utseendet — skjermleser og tastatur
                    får et vanlig checkbox-felt, øyet får mockupens av/på. */}
                <input
                  type="checkbox"
                  className="pf-bryter-input"
                  checked={alltidPa || valgte.includes(n)}
                  // Dashboard og Brukere kan ikke slås av (ALLTID_PA i lib/moduler.ts).
                  disabled={alltidPa}
                  onChange={(e) =>
                    setValgte(e.target.checked ? [...valgte, n] : valgte.filter((v) => v !== n))
                  }
                />
                <span className="pf-bryter" aria-hidden />
                <span style={{ minWidth: 0 }}>
                  <span className="pf-navn">{MENY[n]!.etikett}</span>
                </span>
                <span>
                  {alltidPa ? (
                    <span className="pf-under">Alltid på</span>
                  ) : pris > 0 ? (
                    <span className="pf-merkelapp">{kroner(pris)}/år</span>
                  ) : (
                    <span className="pf-under">Inkludert</span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      ))}

      <div className="pf-prissum">
        <div>
          <span className="pf-under">Listepris</span>
          <span className="pf-prissum-tall">{kroner(listepris)}/år</span>
        </div>
        <div>
          <span className="pf-under">Rabatt</span>
          <span className="pf-prissum-tall">{detalj.abonnement?.discountPercent ?? 0} %</span>
        </div>
        <div>
          <span className="pf-under">Kunden betaler</span>
          {detalj.abonnement ? (
            <span className="pf-prissum-tall">{kroner(avtalesum(detalj.abonnement))}/år</span>
          ) : (
            <span className="pf-prissum-tall pf-ikke-satt">Ikke satt</span>
          )}
        </div>
        <p className="field-note">
          Avtalt pris er låst på kunden og regnes ikke om når prismodellen endres. Modulvalget
          styres bare herfra; kunden har ingen egen bryter.
        </p>
      </div>
    </div>
  );
}

/** Det kunden betaler per år etter avtalen, med frosne priser og rabatt. */
function avtalesum(a: NonNullable<Abonnement>): number {
  return arssum({
    grunnpakke: a.baseFee,
    arsavgift: a.annualFee,
    moduler: a.moduler.map((m) => ({ pris: m.price })),
    rabattProsent: a.discountPercent,
  });
}

// ── Fakturering ─────────────────────────────────────────────────────────────────────────

export function Fakturering({
  detalj,
  orgId,
  onEndret,
  onFeil,
}: {
  detalj: Detalj;
  orgId: string;
  onEndret: () => Promise<void>;
  onFeil: (f: string | null) => void;
}) {
  const [redigerer, setRedigerer] = useState(false);
  const [bekreft, setBekreft] = useState(false);
  const { abonnement, org } = detalj;

  const total = abonnement
    ? arssum({
        grunnpakke: abonnement.baseFee,
        arsavgift: abonnement.annualFee,
        moduler: abonnement.moduler.map((m) => ({ pris: m.price })),
        rabattProsent: abonnement.discountPercent,
      })
    : 0;

  async function slett() {
    setBekreft(false);
    onFeil(null);
    try {
      await api.slett(`/plattform/kunder/${orgId}/abonnement`);
      await onEndret();
    } catch (e) {
      onFeil(e instanceof Error ? e.message : "Kunne ikke slette abonnementet");
    }
  }

  return (
    <>
      <div className="pf-kort">
        <div className="pf-kort-hode">
          <span>Abonnement</span>
          <span style={{ display: "flex", gap: "6px" }}>
            {abonnement && (
              <button className="btn btn-ghost" onClick={() => setBekreft(true)}>
                Slett
              </button>
            )}
            <button className="btn btn-primary" onClick={() => setRedigerer(true)}>
              {abonnement ? "Rediger" : "Opprett abonnement"}
            </button>
          </span>
        </div>

        {!abonnement ? (
          <p className="pf-dempet" style={{ padding: "16px" }}>
            Ingen avtale registrert. Kunden er ikke sperret av det — en manglende kontrakt er
            bokføring som mangler, ikke et signal om at tilgangen skal stenges.
          </p>
        ) : (
          <>
            <div className="pf-rad">
              <span>Grunnpakke</span>
              <span className="pf-dempet">
                {org.unitCount ?? 0} andeler · snapshot fra sist lagring
              </span>
              <span className="pf-tall">{kroner(abonnement.baseFee ?? 0)}</span>
            </div>
            {abonnement.moduler.map((m) => (
              <div key={m.key} className="pf-rad">
                <span>{MENY[m.key as keyof typeof MENY]?.etikett ?? m.key}</span>
                <span />
                <span className="pf-tall">{kroner(m.price)}</span>
              </div>
            ))}
            {abonnement.discountPercent > 0 && (
              <div className="pf-rad">
                <span>Rabatt</span>
                <span />
                <span className="pf-tall">−{abonnement.discountPercent} %</span>
              </div>
            )}
            <div className="pf-rad sum">
              <span>Sum per år</span>
              <span />
              <span className="pf-tall">{kroner(total)}</span>
            </div>
            <div className="pf-kort-kropp">
              <Felt etikett="Avtaleperiode" verdi={periode(abonnement)} />
              {abonnement.notes && <Felt etikett="Notat" verdi={abonnement.notes} />}
            </div>
            {/* Grunnpakken på kontrakten er et snapshot. Har andelstallet eller satsene
                endret seg siden, sier vi fra — ellers fakturerer man et gammelt tall uten
                å vite det. */}
            {abonnement.baseFee !== null && abonnement.baseFee !== detalj.grunnpakkeNaa && (
              <p className="field-note" style={{ padding: "0 16px 14px" }}>
                Med dagens prismodell og {org.unitCount ?? 0} andeler ville grunnpakken vært{" "}
                {kroner(detalj.grunnpakkeNaa)}. Lagre avtalen på nytt for å oppdatere den.
              </p>
            )}
          </>
        )}
      </div>

      {redigerer && (
        <AbonnementModal
          detalj={detalj}
          orgId={orgId}
          onLukk={() => setRedigerer(false)}
          onLagret={() => {
            setRedigerer(false);
            void onEndret();
          }}
        />
      )}

      {bekreft && (
        <Modal tittel="Slett abonnement" onLukk={() => setBekreft(false)} bredde={400}>
          <p style={{ fontSize: "var(--fs-sm)", lineHeight: 1.6 }}>
            Slette den registrerte avtalen for <strong>{org.name}</strong>?
          </p>
          <div className="tips-stripe" style={{ margin: "12px 0" }}>
            <span style={{ fontSize: "var(--fs-sm)", lineHeight: 1.6 }}>
              🛡 Kunden mister ingen tilgang. En manglende kontrakt sperrer ingenting — den er
              bokføring, ikke en bryter.
            </span>
          </div>
          <Knapperad
            onAvbryt={() => setBekreft(false)}
            sendEtikett="Slett avtalen"
            farlig
            onSend={() => void slett()}
          />
        </Modal>
      )}
    </>
  );
}

function periode(a: NonNullable<Abonnement>): string {
  if (!a.startDate && !a.endDate) return "Løpende";
  return `${a.startDate ? dato(a.startDate) : "Ikke satt"} → ${a.endDate ? dato(a.endDate) : "løpende"}`;
}

function AbonnementModal({
  detalj,
  orgId,
  onLukk,
  onLagret,
}: {
  detalj: Detalj;
  orgId: string;
  onLukk: () => void;
  onLagret: () => void;
}) {
  const { abonnement, prismodell, org } = detalj;
  const [rabatt, setRabatt] = useState(abonnement?.discountPercent ?? 0);
  const [start, setStart] = useState(abonnement?.startDate ?? "");
  const [slutt, setSlutt] = useState(abonnement?.endDate ?? "");
  const [notat, setNotat] = useState(abonnement?.notes ?? "");
  const [priser, setPriser] = useState<Record<string, number>>(() => {
    const fra = Object.fromEntries((abonnement?.moduler ?? []).map((m) => [m.key, m.price]));
    return { ...prismodell.modulpriser, ...fra };
  });
  const [valgte, setValgte] = useState<string[]>(
    () => abonnement?.moduler.map((m) => m.key) ?? [],
  );
  const { sender, feil, send } = useSending(onLagret);

  // Grunnpakken regnes ut MENS man ser på skjemaet, fra dagens satser — det er den som
  // lagres. Kontraktens gamle snapshot vises ikke her, nettopp for å unngå at man tror
  // tallet er uendret.
  const base = grunnpakke(org.unitCount, prismodell.gulvpris, prismodell.trinn);
  const modulsum = valgte.reduce((n, k) => n + (priser[k] ?? 0), 0);
  const total = Math.round((base + modulsum) * (1 - rabatt / 100));

  return (
    <Modal tittel="Abonnement" onLukk={onLukk} bredde={560}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(() =>
            api.endre(`/plattform/kunder/${orgId}/abonnement`, {
              moduler: valgte.map((k) => ({ key: k, price: priser[k] ?? 0 })),
              discountPercent: rabatt,
              startDate: start || null,
              endDate: slutt || null,
              notes: notat.trim() || null,
            }),
          );
        }}
      >
        {feil && <div className="feilmelding">{feil}</div>}

        <div className="pf-rad">
          <span>Grunnpakke</span>
          <span className="pf-dempet">{org.unitCount ?? 0} andeler</span>
          <span className="pf-tall">{kroner(base)}</span>
        </div>

        <p className="field-label" style={{ marginTop: "14px" }}>
          Tilleggsmoduler
        </p>
        {TILLEGGSMODULER.map((n) => (
          <div key={n} className="pf-modul-valg">
            <input
              type="checkbox"
              checked={valgte.includes(n)}
              onChange={(e) =>
                setValgte(e.target.checked ? [...valgte, n] : valgte.filter((v) => v !== n))
              }
            />
            <span className="pf-navn">{MENY[n]?.etikett ?? n}</span>
            <input
              className="input"
              type="number"
              min={0}
              style={{ maxWidth: "120px" }}
              aria-label={`Pris for ${MENY[n]?.etikett ?? n}`}
              disabled={!valgte.includes(n)}
              value={priser[n] ?? 0}
              onChange={(e) => setPriser({ ...priser, [n]: parseInt(e.target.value, 10) || 0 })}
            />
          </div>
        ))}

        <Tekstfelt
          etikett="Rabatt (%)"
          type="number"
          verdi={String(rabatt)}
          onEndre={(v) => setRabatt(Math.min(100, Math.max(0, parseInt(v, 10) || 0)))}
        />
        <Tekstfelt etikett="Startdato" type="date" verdi={start} onEndre={setStart} />
        <Tekstfelt
          etikett="Sluttdato"
          type="date"
          verdi={slutt}
          onEndre={setSlutt}
          notat="Tomt = løpende avtale. En utløpt dato sperrer kundens tilgang."
        />
        <Tekstomrade etikett="Notat" verdi={notat} onEndre={setNotat} />

        <div className="pf-rad sum">
          <span>Sum per år</span>
          <span />
          <span className="pf-tall">{kroner(total)}</span>
        </div>

        <Knapperad onAvbryt={onLukk} sendEtikett="Lagre abonnement" sender={sender} />
      </form>
    </Modal>
  );
}

