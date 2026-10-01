"use client";

import { useState } from "react";
import { dato } from "@/components/felles";
import { ALLE_MODULER, TILLEGGSMODULER } from "@/lib/moduler";
import { arssum, kroner } from "@/lib/prisregler";
import { Felt, type Detalj, type Fane, type Kunde } from "./deler";
import { OrgKort, OrgModal, SlettKunde } from "./organisasjon";

/**
 * Fanen «Oversikt» svarer på «hvordan står det til med denne kunden» uten å gå inn i
 * kundens data. Erstatter de tre undersidene Sammendrag, Organisasjon og Onboarding.
 */
export function Oversikt({
  detalj,
  kunde,
  onGaTil,
  onEndret,
}: {
  detalj: Detalj;
  kunde: Kunde;
  onGaTil: (f: Fane) => void;
  onEndret: () => Promise<void>;
}) {
  const [redigerer, setRedigerer] = useState(false);
  const { abonnement, onboarding } = detalj;
  const gjenstaar = onboarding.punkter.filter((p) => !p.ok).length;
  // Listeprisen for dagens modulvalg — det abonnementet VILLE kostet uten rabatt.
  const listepris =
    detalj.grunnpakkeNaa +
    detalj.moduler
      .filter((n) => TILLEGGSMODULER.includes(n as (typeof TILLEGGSMODULER)[number]))
      .reduce((n, m) => n + (detalj.prismodell.modulpriser[m] ?? 0), 0);

  return (
    <>
      <div className="pf-grid">
        <button className="pf-kort pf-snarvei" onClick={() => onGaTil("abonnement")}>
          <span className="pf-snarvei-tittel">Abonnement</span>
          {abonnement ? (
            <>
              <span className="pf-snarvei-tall gronn">
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
                  ` — ${abonnement.discountPercent} % rabatt${abonnement.endDate ? ` til ${dato(abonnement.endDate)}` : ""}`}
              </span>
            </>
          ) : (
            <>
              <span className="pf-snarvei-tall">—</span>
              <span className="pf-under">ingen avtale registrert — opprett →</span>
            </>
          )}
        </button>

        <button className="pf-kort pf-snarvei" onClick={() => onGaTil("abonnement")}>
          <span className="pf-snarvei-tittel">Aktive moduler</span>
          <span className="pf-snarvei-tall">
            {detalj.moduler.length} / {ALLE_MODULER.length}
          </span>
          <span className="pf-under">listepris {kroner(listepris)}/år</span>
        </button>

        <a className="pf-kort pf-snarvei" href="#onboarding">
          <span className="pf-snarvei-tittel">Onboarding</span>
          <span className={`pf-snarvei-tall${onboarding.prosent === 100 ? " gronn" : ""}`}>
            {onboarding.prosent} %
          </span>
          <span className="pf-under">
            {gjenstaar === 0 ? "alt på plass" : `${gjenstaar} ${gjenstaar === 1 ? "punkt" : "punkter"} gjenstår`}
          </span>
        </a>
      </div>

      <div className="pf-oversikt-grid">
        <OrgKort detalj={detalj} onRediger={() => setRedigerer(true)} />
        <div className="pf-kolonne">
          <div className="pf-kort">
            <div className="pf-kort-hode">
              <span>Bruk</span>
            </div>
            <div className="pf-kort-kropp">
              <Felt etikett="Oppgaver" verdi={String(kunde.antallOppgaver)} />
              <Felt etikett="Avvik" verdi={String(kunde.antallAvvik)} />
              <p className="field-note" style={{ marginTop: "10px" }}>
                Antall, ikke innhold. Innholdet krever support-modus.
              </p>
            </div>
          </div>
          <OnboardingKort detalj={detalj} />
        </div>
      </div>

      <SlettKunde org={detalj.org} />

      {redigerer && (
        <OrgModal
          org={detalj.org}
          onLukk={() => setRedigerer(false)}
          onLagret={() => {
            setRedigerer(false);
            void onEndret();
          }}
        />
      )}
    </>
  );
}

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
          <div className="pf-stolpe-fyll" style={{ width: `${onboarding.prosent}%` }} />
        </div>
        {onboarding.punkter.map((p) => (
          <div key={p.nokkel} className="pf-punkt">
            <span className={p.ok ? "pf-hake ok" : "pf-hake"} aria-hidden>
              {p.ok ? "✓" : "○"}
            </span>
            <span className={p.ok ? undefined : "pf-dempet"}>{p.etikett}</span>
            {p.detalj && <span className="pf-under">{p.detalj}</span>}
          </div>
        ))}
        <p className="field-note" style={{ marginTop: "10px" }}>
          Punktene teller kundens rader — hvor mange, aldri hva. De som gjenstår, er som
          regel de kunden må gjøre selv.
        </p>
      </div>
    </div>
  );
}
