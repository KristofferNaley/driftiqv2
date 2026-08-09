"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { useOkt } from "./OktProvider";

/**
 * Org-velgeren.
 *
 * Står til VENSTRE, ved sidetittelen, og ikke blant handlingene til høyre: hvilken
 * organisasjon man er inne i er kontekst for hele skjermbildet, ikke en handling på linje
 * med «Meld feil». Samme plassering som i v1.
 *
 * Rendrer ingenting for brukere med bare én organisasjon — en velger med ett valg er bare
 * støy, og de aller fleste kundebrukere har nøyaktig ett lag.
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
    const påEsc = (e: KeyboardEvent) => e.key === "Escape" && setApen(false);
    document.addEventListener("mousedown", utenfor);
    window.addEventListener("keydown", påEsc);
    return () => {
      document.removeEventListener("mousedown", utenfor);
      window.removeEventListener("keydown", påEsc);
    };
  }, [apen]);

  const orger = bruker?.organisasjoner ?? [];
  if (orger.length < 2) return null;

  return (
    <div ref={ref} style={{ position: "relative", minWidth: 0 }}>
      <button
        className="btn btn-ghost"
        style={{ fontSize: "var(--fs-sm)", padding: "6px 12px" }}
        onClick={() => setApen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={apen}
      >
        <span
          style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "180px" }}
        >
          {aktivOrg?.name ?? "Velg organisasjon"}
        </span>
        <ChevronDown size={15} strokeWidth={2} aria-hidden />
      </button>

      {apen && (
        <div
          role="listbox"
          className="card"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            minWidth: "260px",
            zIndex: 70,
            boxShadow: `0 10px 30px var(--shadow)`,
          }}
        >
          {orger.map((o) => (
            <button
              key={o.id}
              role="option"
              aria-selected={o.id === aktivOrg?.id}
              className="list-item"
              style={{
                width: "100%",
                background: "none",
                border: "none",
                borderBottom: "1px solid var(--border)",
                cursor: "pointer",
                textAlign: "left",
              }}
              onClick={() => {
                velgOrg(o.id);
                setApen(false);
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div className="list-tittel">{o.name}</div>
                <div className="list-meta">{o.nivaa}</div>
              </div>
              {o.id === aktivOrg?.id && (
                <Check size={16} strokeWidth={2.4} color="var(--accent)" aria-hidden />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
