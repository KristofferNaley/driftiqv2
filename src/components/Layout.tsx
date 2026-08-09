"use client";

import { useEffect, useState, type ReactNode } from "react";
import Sidebar from "./Sidebar";
import { useOkt } from "./OktProvider";

const erMobil = () =>
  typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches;

/**
 * App-skallet. Port av v1s `Layout.jsx`.
 *
 * `aside` er en valgfri høyremeny for sidekontekst. Under 1100px stables den under
 * innholdet, og da overtar `.app-body.has-aside` scrollingen.
 *
 * `subnav` er navigasjon innad i en modul. Den ligger utenfor `.app-body` og blir dermed
 * stående øverst også når høyremenyen stables over innholdet.
 *
 * Samme ☰-knapp styrer to ting: på mobil åpner den menyen som skuff, på desktop slår den
 * den sammen til bare ikoner. Valget på desktop huskes mellom besøk.
 */
export default function Layout({
  tittel,
  handlinger,
  subnav,
  aside,
  children,
}: {
  tittel: string;
  handlinger?: ReactNode;
  subnav?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  const { bruker, aktivOrg, versjon } = useOkt();
  const [apen, setApen] = useState(false);
  const [sammenslatt, setSammenslatt] = useState(false);

  // Leses etter montering, ikke i initialverdien: `localStorage` finnes ikke på serveren,
  // og en initialverdi som avviker mellom server og klient gir hydreringsfeil.
  useEffect(() => {
    setSammenslatt(localStorage.getItem("sidebarSammenslatt") === "true");
  }, []);

  const vekslMeny = () => {
    if (erMobil()) {
      setApen((v) => !v);
    } else {
      setSammenslatt((v) => {
        localStorage.setItem("sidebarSammenslatt", String(!v));
        return !v;
      });
    }
  };

  return (
    <div className="app-shell">
      {apen && <div className="sidebar-backdrop" onClick={() => setApen(false)} />}
      <Sidebar
        apen={apen}
        sammenslatt={sammenslatt}
        aktiverteModuler={aktivOrg?.enabledModules ?? null}
        versjon={versjon}
        onLukk={() => setApen(false)}
      />

      <div className="app-main">
        <div className="topbar">
          <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
            <button
              className="menu-btn"
              onClick={vekslMeny}
              aria-label={sammenslatt ? "Vis sidemeny" : "Skjul sidemeny"}
            >
              ☰
            </button>
            <div className="page-title">{tittel}</div>
          </div>
          <div className="topbar-right">
            {handlinger}
            <span style={{ color: "var(--muted)" }}>{bruker?.name}</span>
          </div>
        </div>

        {subnav && <div className="app-subnav">{subnav}</div>}

        <div className={`app-body${aside ? " has-aside" : ""}`}>
          {children}
          {aside && <aside className="app-aside">{aside}</aside>}
        </div>
      </div>
    </div>
  );
}
