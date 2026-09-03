"use client";

import type { ReactNode } from "react";
import { Feil, Kort, Rad, Tom, dato, useOrgData } from "@/components/felles";
import { okonomi } from "@/lib/klient";
import {
  KJORING_STATUS_ETIKETT,
  andelAvAaret,
  brokStemmer,
  forventetHittil,
  halvaarsperioder,
  isoDato,
  kroner,
  type KjoringStatus,
} from "@/lib/okonomiregler";
import type { OkonomiFane } from "./page";

/**
 * Oversikten — det styret ser først: hva som venter på dem, hvor de ligger mot budsjettet,
 * og om grunnlaget (eiere, brøk, satser) er komplett nok til å fakturere. Layoutintensjonen
 * er mockupen «DriftIQ Økonomi» (03.09.2026): fire nøkkeltall, budsjett mot regnskap til
 * venstre, «trenger oppfølging» til høyre. Det som krever regnskapskobling (bankinnskudd,
 * innbetalinger) er ikke med før koblingen finnes.
 */
export default function Oversikt({ onGaaTil }: { onGaaTil: (f: OkonomiFane, id?: string) => void }) {
  const { data, feil, laster } = useOrgData((o) => okonomi.oversikt(o));

  if (laster || !data) return <Tom tekst="Henter …" />;

  const b = data.budsjett;
  const naa = new Date();
  const brokOk = brokStemmer(data.eiere.brokSum);
  const andel = andelAvAaret(data.aar, naa);
  const forventetKostnader = b ? forventetHittil(b.summer.kostnader, b.year, naa) : 0;
  const nesteKjoring = nesteHalvaar(data.sisteKjoring?.periodEnd ?? null, naa);

  const oppfolging: Array<{ merke: string; etikett: string; tittel: string; meta: string; fane: OkonomiFane; knapp: string }> = [];
  if (data.fakturaer.forfalte.antall > 0) {
    oppfolging.push({
      merke: "danger", etikett: "Forfalt", tittel: `${data.fakturaer.forfalte.antall} ${data.fakturaer.forfalte.antall === 1 ? "faktura" : "fakturaer"} forfalt`,
      meta: `${kroner(data.fakturaer.forfalte.sum)} — godkjent, men ikke registrert betalt, eller ikke behandlet`, fane: "fakturaer", knapp: "Åpne",
    });
  }
  if (data.fakturaer.tilGodkjenning.antall > 0) {
    oppfolging.push({
      merke: "warn", etikett: "Godkjenning", tittel: `${data.fakturaer.tilGodkjenning.antall} ${data.fakturaer.tilGodkjenning.antall === 1 ? "faktura venter" : "fakturaer venter"} på styret`,
      meta: kroner(data.fakturaer.tilGodkjenning.sum), fane: "fakturaer", knapp: "Behandle",
    });
  }
  if (data.eiere.utenEier > 0) {
    oppfolging.push({
      merke: "warn", etikett: "Eier", tittel: `${data.eiere.utenEier} ${data.eiere.utenEier === 1 ? "seksjon" : "seksjoner"} uten registrert eier`,
      meta: "Fakturagrunnlaget får linjer uten mottaker til det er rettet", fane: "eiere", knapp: "Registrer",
    });
  }
  if (data.eiere.utenBrok > 0 || !brokOk) {
    oppfolging.push({
      merke: "warn", etikett: "Brøk",
      tittel: data.eiere.utenBrok > 0 ? `${data.eiere.utenBrok} ${data.eiere.utenBrok === 1 ? "seksjon" : "seksjoner"} uten sameiebrøk` : `Brøkene summerer til ${data.eiere.brokSum.toFixed(3)}`,
      meta: data.eiere.utenBrok > 0 ? "Uten brøk får seksjonen ingen beregnet sats" : "Skal være 1,000 — sjekk mot det tinglyste", fane: "eiere", knapp: "Rett",
    });
  }
  if (!b) {
    oppfolging.push({ merke: "info", etikett: "Budsjett", tittel: `Ingen budsjett for ${data.aar}`, meta: "Lag et — det er grunnlaget for satsene", fane: "budsjett", knapp: "Lag" });
  } else if (b.status !== "vedtatt") {
    oppfolging.push({ merke: "info", etikett: "Budsjett", tittel: `Budsjett ${data.aar} er ikke vedtatt`, meta: "Vedtaket låser linjene og gir satsene", fane: "budsjett", knapp: "Åpne" });
  }
  if (data.satser.utenSats > 0 && data.eiere.seksjoner > 0) {
    oppfolging.push({
      merke: "warn", etikett: "Sats", tittel: `${data.satser.utenSats} ${data.satser.utenSats === 1 ? "seksjon" : "seksjoner"} mangler sats`,
      meta: b?.status === "vedtatt" ? "Trykk «Beregn satser» på budsjettet" : "Krever vedtatt budsjett, eller sett sats manuelt", fane: "felleskostnader", knapp: "Åpne",
    });
  }
  if (nesteKjoring && data.satser.utenSats === 0 && data.satser.maanedligSum > 0) {
    oppfolging.push({
      merke: "info", etikett: "Kjøring", tittel: `${nesteKjoring.etikett} er ikke kjørt`,
      meta: `${data.eiere.seksjoner * 6} linjer · ${kroner(data.satser.maanedligSum * 6)}`, fane: "felleskostnader", knapp: "Kjør",
    });
  }

  return (
    <>
      <Feil melding={feil} />

      <div className="ok-kpi-grid">
        <Kpi tone="blaa" etikett="Felleskostnader per måned" verdi={kroner(data.satser.maanedligSum)}
          under={data.satser.utenSats > 0 ? `${data.satser.utenSats} seksjoner uten sats` : `${kroner(data.satser.aarligSum)} per år · ${data.eiere.seksjoner} seksjoner`} />
        <Kpi tone={data.fakturaer.tilGodkjenning.antall > 0 ? "gul" : "gronn"} etikett="Til godkjenning" verdi={String(data.fakturaer.tilGodkjenning.antall)}
          under={data.fakturaer.tilGodkjenning.antall > 0 ? `${kroner(data.fakturaer.tilGodkjenning.sum)} venter på styret` : "Ingen fakturaer venter"} />
        <Kpi tone={data.fakturaer.forfalte.antall > 0 ? "roed" : "gronn"} etikett="Forfalt" verdi={String(data.fakturaer.forfalte.antall)}
          under={data.fakturaer.forfalte.antall > 0 ? `${kroner(data.fakturaer.forfalte.sum)} over forfall` : `${data.fakturaer.godkjentIkkeBetalt.antall} godkjent, ikke betalt`} />
        <Kpi tone="blaa" etikett="Neste kjøring" verdi={nesteKjoring ? dato(nesteKjoring.start) : "—"}
          under={nesteKjoring ? `${nesteKjoring.etikett} · ${data.eiere.seksjoner * 6} fakturaer · ${kroner(data.satser.maanedligSum * 6)}` : "Begge halvår er kjørt"} />
      </div>

      <div className="ok-to-kolonner ok-to-kolonner-bred">
        <Kort
          tittel={`Budsjett mot faktisk ${data.aar}`}
          handling={
            <div className="ok-handlinger">
              {b && <span className="list-meta">Forventet = budsjett × {Math.round(andel * 12)}/12</span>}
              <button className="btn btn-ghost" onClick={() => onGaaTil("budsjett")}>Åpne budsjettet</button>
            </div>
          }
        >
          {!b ? (
            <Tom tekst={`Ingen budsjett for ${data.aar}. Lag et under «Budsjett» — det er grunnlaget for satsene.`} />
          ) : b.linjer.length === 0 ? (
            <Tom tekst="Budsjettet har ingen kostnadslinjer." />
          ) : (
            <div className="ok-bmf">
              {b.linjer.map((l) => {
                const prosent = l.amount > 0 ? Math.min(100, Math.round((l.faktisk / l.amount) * 100)) : l.faktisk > 0 ? 100 : 0;
                const forventet = forventetHittil(l.amount, b.year, naa);
                const over = l.faktisk > forventet && l.faktisk > 0;
                return (
                  <div key={l.id} className="ok-bmf-rad">
                    <div className="ok-bmf-navn">
                      <span className="list-tittel">{l.name}</span>
                      <span className="list-meta">{kroner(l.faktisk)} av {kroner(l.amount)}{andel > 0 && andel < 1 ? ` · forventet ${kroner(forventet)}` : ""}</span>
                    </div>
                    <div className="ok-stolpe" aria-hidden>
                      <div className={`ok-stolpe-fyll${over ? " over" : ""}`} style={{ width: `${prosent}%` }} />
                      {andel > 0 && andel < 1 && <div className="ok-stolpe-merke" style={{ left: `${Math.round(andel * 100)}%` }} />}
                    </div>
                    <span className={`ok-bmf-prosent${over ? " over" : ""}`}>{prosent} %</span>
                  </div>
                );
              })}
              <div className="ok-bmf-sum">
                <span>Sum kostnader</span>
                <span>
                  {kroner(b.faktiskKostnader)} av {kroner(b.summer.kostnader)}
                  {andel > 0 && andel < 1 && (
                    <span className={`ok-bmf-avvik${b.faktiskKostnader > forventetKostnader ? " over" : ""}`}>
                      {" "}· {b.faktiskKostnader > forventetKostnader ? "over" : "under"} forventet med {kroner(Math.abs(forventetKostnader - b.faktiskKostnader))}
                    </span>
                  )}
                </span>
              </div>
            </div>
          )}
        </Kort>

        <Kort tittel="Trenger oppfølging">
          {oppfolging.length === 0 ? (
            <div className="ok-alt-ok">
              <span className="ok-sjekk-prikk ok" aria-hidden /> Alt er på plass: eiere, brøk, vedtatt budsjett og satser.
            </div>
          ) : (
            oppfolging.map((o) => (
              <div key={o.tittel} className="ok-oppf-rad">
                <span className={`badge ${o.merke}`}>{o.etikett}</span>
                <div style={{ minWidth: 0 }}>
                  <div className="list-tittel">{o.tittel}</div>
                  <div className="list-meta">{o.meta}</div>
                </div>
                <button className="btn btn-ghost" onClick={() => onGaaTil(o.fane)}>{o.knapp}</button>
              </div>
            ))
          )}
        </Kort>
      </div>

      <div className="ok-to-kolonner">
        <Kort
          tittel="Venter på godkjenning"
          handling={<button className="btn btn-ghost" onClick={() => onGaaTil("fakturaer")}>Alle fakturaer</button>}
        >
          {data.fakturaer.nyeste.length === 0 ? (
            <Tom tekst="Ingen fakturaer venter på godkjenning." />
          ) : (
            data.fakturaer.nyeste.map((f) => (
              <Rad
                key={f.id}
                tittel={`${f.leverandorNavn}${f.invoiceNumber ? ` · ${f.invoiceNumber}` : ""}`}
                meta={`${f.description ?? f.budsjettlinjeNavn ?? "—"} · forfall ${dato(f.dueDate)}`}
                hoyre={
                  <>
                    {f.forfalt && <span className="badge danger">Forfalt</span>}
                    <span className="ok-belop-celle">{kroner(f.amount)}</span>
                  </>
                }
                onClick={() => onGaaTil("fakturaer", f.id)}
              />
            ))
          )}
        </Kort>

        <Kort
          tittel="Fakturagrunnlag"
          handling={<button className="btn btn-ghost" onClick={() => onGaaTil("felleskostnader")}>Felleskostnader</button>}
        >
          {data.sisteKjoring ? (
            <Rad
              tittel={`${dato(data.sisteKjoring.periodStart)} – ${dato(data.sisteKjoring.periodEnd)}`}
              meta={`${data.sisteKjoring.lineCount} linjer · ${kroner(data.sisteKjoring.totalAmount)} · laget av ${data.sisteKjoring.createdBy}${data.sisteKjoring.missingOwners ? ` · ${data.sisteKjoring.missingOwners} uten eier` : ""}`}
              hoyre={
                <span className={`badge ${KJORING_STATUS_ETIKETT[data.sisteKjoring.status as KjoringStatus]?.merke ?? "muted"}`}>
                  {KJORING_STATUS_ETIKETT[data.sisteKjoring.status as KjoringStatus]?.etikett ?? data.sisteKjoring.status}
                </span>
              }
            />
          ) : (
            <Tom tekst="Ingen fakturagrunnlag laget ennå. Kjøringen lager én linje per seksjon per måned for et halvår." />
          )}
          {data.fakturaer.betaltIAar.antall > 0 && (
            <div className="list-meta" style={{ padding: "10px 14px" }}>
              Betalt i {data.aar}: {data.fakturaer.betaltIAar.antall} fakturaer, {kroner(data.fakturaer.betaltIAar.sum)}.
            </div>
          )}
        </Kort>
      </div>
    </>
  );
}

/** Nøkkeltall med fargebånd i toppen — mockupens `kpi-kort`, med modulprefiks. */
function Kpi({ tone, etikett, verdi, under }: { tone: "blaa" | "gronn" | "gul" | "roed"; etikett: string; verdi: ReactNode; under?: ReactNode }) {
  return (
    <div className={`card ok-kpi-kort ok-kpi-${tone}`}>
      <div className="ok-kpi-etikett">{etikett}</div>
      <div className="ok-kpi-tall">{verdi}</div>
      {under && <div className="ok-kpi-under">{under}</div>}
    </div>
  );
}

/** Første halvårsperiode som starter etter forrige kjørings slutt — eller etter i dag. */
function nesteHalvaar(sistePeriodeSlutt: string | null, naa: Date) {
  const iDag = isoDato(naa);
  const fra = sistePeriodeSlutt && sistePeriodeSlutt > iDag ? sistePeriodeSlutt : iDag;
  const aar = Number(fra.slice(0, 4));
  return [...halvaarsperioder(aar), ...halvaarsperioder(aar + 1)].find((p) => p.start > fra) ?? null;
}
