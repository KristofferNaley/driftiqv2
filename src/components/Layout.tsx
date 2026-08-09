"use client";

import { useEffect, useState, type ReactNode } from "react";
import OrgVelger from "./OrgVelger";
import Sidebar from "./Sidebar";
import { useOkt } from "./OktProvider";
import { NIVA_ETIKETT } from "@/lib/nivaer";
import ProfilModal from "./ProfilModal";
import { MeldFeil } from "./MeldFeil";

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
/**
 * Lenke til panelet fra kunde-appen.
 *
 * Absolutt til panelverten når vertene er delt — `/plattform` er en 404 på kundeverten.
 * `adminVert` kommer fra `/meg`, altså fra serveren ved kjøretid.
 */
function panelLenke(adminVert: string | null, orgId: string): string {
  const sti = `/plattform/kunder/${orgId}`;
  return adminVert ? `https://${adminVert}${sti}` : sti;
}

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
  const { bruker, aktivOrg, versjon, laster } = useOkt();
  const [apen, setApen] = useState(false);
  const [sammenslatt, setSammenslatt] = useState(false);
  const [profil, setProfil] = useState(false);

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
      {/* `bruker.tittel` får ETIKETTEN, ikke råverdien: `orgadmin` er et kodenavn, og kunden
          skal lese «Kontoadmin». Se lib/nivaer.ts for hvorfor de to er ulike med vilje. */}
      <Sidebar
        apen={apen}
        sammenslatt={sammenslatt}
        aktiverteModuler={aktivOrg?.enabledModules ?? null}
        oktKjent={!laster}
        bruker={
          bruker
            ? {
                navn: bruker.name,
                tittel:
                  aktivOrg && bruker.supportOrger?.includes(aktivOrg.id)
                    ? "Support-modus"
                    : aktivOrg
                      ? (NIVA_ETIKETT[aktivOrg.nivaa] ?? null)
                      : null,
              }
            : null
        }
        versjon={versjon}
        onLukk={() => setApen(false)}
        onProfil={() => setProfil(true)}
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
            {/* Kontekst for HELE skjermbildet — derfor til venstre, ved tittelen. */}
            <OrgVelger />
          </div>
          <div className="topbar-right">
            {handlinger}
            {/* Alltid tilgjengelig, på hver eneste side. En feil meldes der den oppdages —
                må man lete etter knappen, blir den ikke meldt. */}
            <MeldFeil versjon={versjon} />
          </div>
        </div>

        {/* Support-modus MÅ være synlig mens du er inne. Uten dette ser sidemenyen og
            tilgangsnivået ut som om du er et vanlig styremedlem — og et innsyn som er
            usynlig for den som utfører det, er den verste varianten. */}
        {aktivOrg && bruker?.supportOrger?.includes(aktivOrg.id) && (
          <div className="support-stripe">
            <span>
              <b>Support-modus.</b> Du ser {aktivOrg.name} sine data på et logget innsyn.
            </span>
            <a href={panelLenke(bruker?.adminVert ?? null, aktivOrg.id)}>Avslutt i plattformpanelet →</a>
          </div>
        )}

        {subnav && <div className="app-subnav">{subnav}</div>}

        <div className={`app-body${aside ? " has-aside" : ""}`}>
          {children}
          {aside && <aside className="app-aside">{aside}</aside>}
        </div>
      </div>

      {profil && (
        <ProfilModal
          orgId={aktivOrg?.id ?? null}
          onLukk={() => setProfil(false)}
          // Navnet står i profilblokken i sidemenyen, så en endring må hentes på nytt.
          onLagret={() => window.location.reload()}
        />
      )}
    </div>
  );
}
