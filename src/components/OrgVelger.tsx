"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { useOkt } from "./OktProvider";
import { NIVA_ETIKETT } from "@/lib/nivaer";

/**
 * Hvilken organisasjon man er inne i — øverst i sidemenyen, rett over Dashboard.
 *
 * ## Hvorfor den flyttet hit fra toppbaren
 *
 * Org-en er kontekst for HELE skjermbildet, ikke en handling. I toppbaren sto den på linje
 * med «Meld feil» og leste som en knapp blant knapper. I sidemenyen står den over
 * menypunktene den faktisk gjelder for, og kundens navn er det første man ser.
 *
 * ## Alltid synlig, men bare klikkbar når det er noe å velge mellom
 *
 * Med ett lag er en velger bare støy — men navnet skal fortsatt stå der. Det er DERES
 * system. Derfor: ren etikett ved ett medlemskap, nedtrekk ved flere.
 */
export default function OrgVelger() {
  const { bruker, aktivOrg, velgOrg } = useOkt();
  const [apen, setApen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!apen) return;
    const utenfor = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setApen(false);
    };
    const paaEsc = (e: KeyboardEvent) => e.key === "Escape" && setApen(false);
    document.addEventListener("mousedown", utenfor);
    window.addEventListener("keydown", paaEsc);
    return () => {
      document.removeEventListener("mousedown", utenfor);
      window.removeEventListener("keydown", paaEsc);
    };
  }, [apen]);

  const orger = bruker?.organisasjoner ?? [];
  if (!aktivOrg) return null;

  if (orger.length < 2) {
    return (
      <div className="org-blokk statisk" title={aktivOrg.name}>
        <span className="org-blokk-navn">{aktivOrg.name}</span>
      </div>
    );
  }

  return (
    <div ref={ref} className="org-velger">
      <button
        className="org-blokk"
        onClick={() => setApen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={apen}
        title={aktivOrg.name}
      >
        <span className="org-blokk-navn">{aktivOrg.name}</span>
        <ChevronDown size={15} strokeWidth={2} aria-hidden />
      </button>

      {apen && (
        <div role="listbox" className="org-panel">
          {orger.map((o) => (
            <button
              key={o.id}
              role="option"
              aria-selected={o.id === aktivOrg.id}
              // `color: inherit` er ikke valgfritt: en knapp arver ikke tekstfarge, og uten
              // det ble navnene svarte på mørk bakgrunn. Samme felle som .profil-blokk.
              className={`org-valg${o.id === aktivOrg.id ? " valgt" : ""}`}
              onClick={() => {
                velgOrg(o.id);
                setApen(false);
              }}
            >
              <span style={{ minWidth: 0 }}>
                <span className="org-valg-navn">{o.name}</span>
                {/* Etiketten, ikke råverdien — «orgadmin» er et kodenavn. */}
                <span className="org-valg-niva">
                  {o.tittel?.trim() || NIVA_ETIKETT[o.nivaa] || o.nivaa}
                </span>
              </span>
              {o.id === aktivOrg.id && (
                <Check size={16} strokeWidth={2.4} color="var(--accent)" aria-hidden />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
