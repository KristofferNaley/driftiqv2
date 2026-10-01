"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Ramme } from "../../ramme";
import { api } from "@/lib/klient";
import { ALLE_MODULER } from "@/lib/moduler";
import { Fakturering, ModulFane } from "./abonnement";
import { FANER, tolkFane, type Detalj, type Fane, type Kunde } from "./deler";
import { Kundehode, SupportDialog, SupportStripe } from "./hode";
import { OrgModal } from "./organisasjon";
import { Oversikt } from "./oversikt";
import { Tilgang } from "./tilgang";

/**
 * Kundedetaljen — DriftIQs bilde av ÉN kunde. Tre faner (BL-180): Oversikt, Abonnement og
 * Tilgang. Før var det sju undersider i en vertikal skinne, og det samme feltet sto på flere
 * av dem.
 *
 * Valgt fane står i `?fane=`, så en lenke kan peke rett på en fane. Den leses fra
 * `window.location` etter montering, ikke med `useSearchParams()` — den tvinger hele treet
 * under seg til klientrendring (se CLAUDE.md, «Next-spesifikke feller»).
 */

const ETIKETT: Record<Fane, string> = {
  oversikt: "Oversikt",
  abonnement: "Abonnement",
  tilgang: "Tilgang",
};

export default function Kundedetalj({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = use(params);
  const [kunde, setKunde] = useState<Kunde | null>(null);
  const [detalj, setDetalj] = useState<Detalj | null>(null);
  const [feil, setFeil] = useState<string | null>(null);
  const [fane, setFane] = useState<Fane>("oversikt");
  const [redigerer, setRedigerer] = useState(false);
  const [supportApen, setSupportApen] = useState(false);

  useEffect(() => {
    setFane(tolkFane(new URLSearchParams(window.location.search).get("fane")));
  }, []);

  const velgFane = useCallback((f: Fane) => {
    setFane(f);
    const url = new URL(window.location.href);
    if (f === "oversikt") url.searchParams.delete("fane");
    else url.searchParams.set("fane", f);
    window.history.replaceState(null, "", url);
  }, []);

  const last = useCallback(async () => {
    try {
      const [k, d] = await Promise.all([
        api.hent<Kunde>(`/plattform/kunder/${orgId}`),
        api.hent<Detalj>(`/plattform/kunder/${orgId}/detalj`),
      ]);
      setKunde(k);
      setDetalj(d);
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke hente kunden");
    }
  }, [orgId]);

  useEffect(() => {
    void last();
  }, [last]);

  if (!kunde || !detalj) {
    return (
      <Ramme tittel="Kunde">
        {feil ? <div className="feilmelding">{feil}</div> : <p className="pf-dempet">Henter …</p>}
      </Ramme>
    );
  }

  const merker: Record<Fane, { tekst: string; klasse: string } | null> = {
    oversikt: null,
    abonnement: { tekst: `${detalj.moduler.length}/${ALLE_MODULER.length}`, klasse: "muted" },
    tilgang: { tekst: String(kunde.brukere.length), klasse: "muted" },
  };

  return (
    <Ramme tittel="Kunder">
      <Link href="/plattform/kunder" className="tilbake-lenke">
        ← Alle kunder
      </Link>

      <SupportStripe kunde={kunde} orgId={orgId} onEndret={last} onFeil={setFeil} />

      <Kundehode
        detalj={detalj}
        kunde={kunde}
        onRediger={() => {
          // Organisasjon bor på Oversikt — den som lukker skjemaet skal se kortet de endret.
          velgFane("oversikt");
          setRedigerer(true);
        }}
        onSupport={() => setSupportApen(true)}
      />

      {feil && <div className="feilmelding">{feil}</div>}

      <div className="pf-faner" role="tablist" aria-label="Kundeseksjoner">
        {FANER.map((f) => (
          <button
            key={f}
            role="tab"
            aria-selected={fane === f}
            className={`pf-fane${fane === f ? " valgt" : ""}`}
            onClick={() => velgFane(f)}
          >
            {ETIKETT[f]}
            {merker[f] && <span className={`badge ${merker[f].klasse}`}>{merker[f].tekst}</span>}
          </button>
        ))}
      </div>

      {fane === "oversikt" && (
        <Oversikt
          detalj={detalj}
          kunde={kunde}
          onGaTil={velgFane}
          onRediger={() => setRedigerer(true)}
        />
      )}
      {fane === "abonnement" && (
        <>
          <ModulFane detalj={detalj} orgId={orgId} onEndret={last} />
          <Fakturering detalj={detalj} orgId={orgId} onEndret={last} onFeil={setFeil} />
        </>
      )}
      {fane === "tilgang" && (
        <Tilgang kunde={kunde} />
      )}

      {redigerer && (
        <OrgModal
          org={detalj.org}
          onLukk={() => setRedigerer(false)}
          onLagret={() => {
            setRedigerer(false);
            void last();
          }}
        />
      )}
      {supportApen && (
        <SupportDialog
          kunde={kunde}
          orgId={orgId}
          onLukk={() => setSupportApen(false)}
          onStartet={() => {
            setSupportApen(false);
            void last();
          }}
        />
      )}
    </Ramme>
  );
}
