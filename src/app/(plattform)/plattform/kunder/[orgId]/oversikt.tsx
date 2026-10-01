"use client";

import { dato, datoTid, dagerSiden } from "@/components/felles";
import { ALLE_MODULER, MENY } from "@/lib/moduler";
import { arssum, kroner } from "@/lib/prisregler";
import { Felt, type Detalj, type Fane, type Kunde } from "./deler";
import { OrgKort, SlettKunde } from "./organisasjon";

/**
 * Fanen «Oversikt» svarer på «hvordan står det til med denne kunden» uten å gå inn i
 * kundens data. Erstatter de tre undersidene Sammendrag, Organisasjon og Onboarding.
 * «Krever handling» står over den (page.tsx), fordi antallet også vises på fanen.
 *
 * Ingen felt vises to steder: andeler, status og «kunde siden» står i hodet, resten i
 * Organisasjon-kortet. Nøkkeltallene er sammendrag med lenke videre, ikke kopier.
 */
export function Oversikt({
  detalj,
  kunde,
  onGaTil,
  onRediger,
}: {
  detalj: Detalj;
  kunde: Kunde;
  onGaTil: (f: Fane) => void;
  onRediger: () => void;
}) {
  return (
    <>
      <Nokkeltall detalj={detalj} kunde={kunde} onGaTil={onGaTil} />

      <div className="pf-oversikt-grid">
        <OrgKort detalj={detalj} onRediger={onRediger} />
        <div className="pf-kolonne">
          <Aktivitet detalj={detalj} kunde={kunde} />
          <OnboardingKort detalj={detalj} />
        </div>
      </div>

      <SlettKunde org={detalj.org} />
    </>
  );
}

// ── Nøkkeltall ──────────────────────────────────────────────────────────────────────────

function Nokkeltall({
  detalj,
  kunde,
  onGaTil,
}: {
  detalj: Detalj;
  kunde: Kunde;
  onGaTil: (f: Fane) => void;
}) {
  const { abonnement, onboarding } = detalj;
  const av = ALLE_MODULER.filter((n) => !detalj.moduler.includes(n)).map((n) => MENY[n]?.etikett ?? n);
  const mangler = onboarding.punkter.filter((p) => !p.ok).map((p) => kortEtikett(p.etikett));

  return (
    <div className="pf-nokkeltall">
      <button className="pf-kort pf-kpi-knapp" onClick={() => onGaTil("abonnement")}>
        <span className="pf-snarvei-tittel">Abonnement</span>
        {abonnement ? (
          <>
            <span className="pf-kpi-tall">
              {kroner(
                arssum({
                  grunnpakke: abonnement.baseFee,
                  arsavgift: abonnement.annualFee,
                  moduler: abonnement.moduler.map((m) => ({ pris: m.price })),
                  rabattProsent: abonnement.discountPercent,
                }),
              )}
            </span>
            <span className="pf-under">
              per år
              {abonnement.discountPercent > 0 &&
                `, ${abonnement.discountPercent} % rabatt${abonnement.endDate ? ` til ${dato(abonnement.endDate)}` : ""}`}
            </span>
          </>
        ) : (
          <>
            <span className="pf-kpi-tall pf-ikke-satt">Ikke satt</span>
            <span className="pf-under">Ingen avtale registrert</span>
          </>
        )}
      </button>

      <button className="pf-kort pf-kpi-knapp" onClick={() => onGaTil("abonnement")}>
        <span className="pf-snarvei-tittel">Moduler</span>
        <span className="pf-kpi-tall">
          {detalj.moduler.length} / {ALLE_MODULER.length}
        </span>
        <span className="pf-under">{av.length === 0 ? "Alle moduler på" : `${av.join(", ")} er av`}</span>
      </button>

      <a className="pf-kort pf-kpi-knapp" href="#onboarding">
        <span className="pf-snarvei-tittel">Onboarding</span>
        <span className="pf-kpi-tall">{onboarding.prosent} %</span>
        <span className={`pf-under${mangler.length ? " pf-varseltekst" : ""}`}>
          {mangler.length === 0 ? "Ferdig" : `${mangler.join(", ")} mangler`}
        </span>
      </a>

      <button className="pf-kort pf-kpi-knapp" onClick={() => onGaTil("tilgang")}>
        <span className="pf-snarvei-tittel">Sist aktiv</span>
        {kunde.sistAktiv ? (
          <>
            <span className="pf-kpi-tall">{dagerTekst(kunde.sistAktiv.tid)}</span>
            <span className="pf-under">
              {kunde.sistAktiv.navn}, {datoTid(kunde.sistAktiv.tid)}
            </span>
          </>
        ) : (
          <>
            <span className="pf-kpi-tall pf-ikke-satt">Aldri</span>
            <span className="pf-under">Ingen fra kunden har logget inn</span>
          </>
        )}
      </button>
    </div>
  );
}

/** «Styret lagt inn (minst 2 brukere)» → «Styret lagt inn»: forklaringen hører til lista. */
const kortEtikett = (etikett: string) => etikett.replace(/\s*\(.*\)$/, "");

function dagerTekst(tid: string): string {
  const d = dagerSiden(tid) ?? 0;
  if (d <= 0) return "I dag";
  if (d === 1) return "I går";
  return `${d} dager`;
}

// ── Aktivitet ───────────────────────────────────────────────────────────────────────────

/**
 * Bruken i tall: siste innlogging, antall oppgaver, avvik og kontrakter, og innlogginger per
 * uke. Aldri innhold — det krever support-modus.
 */
function Aktivitet({ detalj, kunde }: { detalj: Detalj; kunde: Kunde }) {
  const uker = kunde.innloggingerPerUke;
  const maks = Math.max(1, ...uker.map((u) => u.antall));
  return (
    <div className="pf-kort">
      <div className="pf-kort-hode">
        <span>Aktivitet</span>
        <span className="pf-under">Antall, ikke innhold</span>
      </div>
      <div className="pf-kort-kropp">
        <div
          className="pf-soyler"
          role="img"
          aria-label={`Innlogginger per uke, siste 12 uker: ${uker.map((u) => u.antall).join(", ")}`}
        >
          {uker.map((u) => (
            <span
              key={u.uke}
              className="pf-soyle"
              style={{ height: `${(u.antall / maks) * 100}%` }}
              title={`Uke fra ${dato(u.uke)}: ${u.antall}`}
            />
          ))}
        </div>
        <p className="pf-under" style={{ margin: "0 0 6px" }}>
          Innlogginger per uke, siste 12 uker
        </p>
        <Felt etikett="Siste innlogging" verdi={kunde.sistAktiv ? datoTid(kunde.sistAktiv.tid) : null} />
        <Felt etikett="Oppgaver" verdi={String(kunde.antallOppgaver)} />
        <Felt etikett="Avvik" verdi={String(kunde.antallAvvik)} />
        <Felt etikett="Kontrakter" verdi={String(detalj.onboarding.tellinger.kontrakter)} />
        <p className="field-note" style={{ marginTop: "10px" }}>
          Innhold krever support-modus.
        </p>
      </div>
    </div>
  );
}

// ── Onboarding ──────────────────────────────────────────────────────────────────────────

function OnboardingKort({ detalj }: { detalj: Detalj }) {
  const { onboarding } = detalj;
  return (
    <div className="pf-kort" id="onboarding">
      <div className="pf-kort-hode">
        <span>Onboarding</span>
        <span className="pf-tall">{onboarding.prosent} %</span>
      </div>
      <div className="pf-kort-kropp">
        <div className="pf-stolpe">
          <div
            className={`pf-stolpe-fyll${onboarding.prosent < 100 ? " varsel" : ""}`}
            style={{ width: `${onboarding.prosent}%` }}
          />
        </div>
        {onboarding.punkter.map((p) => (
          <div key={p.nokkel} className="pf-punkt">
            <span className={p.ok ? "pf-hake ok" : "pf-hake"} aria-hidden>
              {p.ok ? "✓" : "○"}
            </span>
            <span className={p.ok ? undefined : "pf-varseltekst"}>{p.etikett}</span>
            {p.detalj && <span className="pf-under">{p.detalj}</span>}
          </div>
        ))}
        <p className="field-note" style={{ marginTop: "10px" }}>
          Punktene teller kundens rader, aldri innholdet. Plattformbrukere teller ikke.
        </p>
      </div>
    </div>
  );
}
