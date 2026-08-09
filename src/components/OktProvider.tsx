"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { meg, type MegSvar } from "@/lib/klient";

/**
 * Økten: hvem er innlogget, hvilken organisasjon er aktiv, og hva har den av moduler.
 *
 * **Hentes fra API-et, ikke fra localStorage.** v1 leste tilgangsnivået fra `localStorage`
 * og friskiet det bare opp ved oppstart — innenfor en økt var det et snapshot. Endret noen
 * et medlemskap, så ikke den åpne fanen det før neste sidelast, og symptomet var lesevisning
 * uten forklaring: knappene forsvant, API-et svarte 200.
 *
 * Her ligger bare VALGET av org i localStorage. Selve tilgangen kommer fra `/api/meg` og
 * gates uansett av serveren ved hvert kall.
 */

type Org = MegSvar["organisasjoner"][number];

type Okt = {
  bruker: MegSvar | null;
  aktivOrg: Org | null;
  velgOrg: (orgId: string) => void;
  versjon: string;
  laster: boolean;
};

const OktKontekst = createContext<Okt | null>(null);

export function useOkt(): Okt {
  const kontekst = useContext(OktKontekst);
  if (!kontekst) throw new Error("useOkt må brukes inne i <OktProvider>");
  return kontekst;
}

/** Aktiv org i URL-en er sannheten hvis den finnes; ellers sist valgte; ellers første. */
function velgStartOrg(orgs: Org[]): Org | null {
  if (orgs.length === 0) return null;
  const lagret = typeof window !== "undefined" ? localStorage.getItem("aktivOrgId") : null;
  return orgs.find((o) => o.id === lagret) ?? orgs[0]!;
}

export function OktProvider({ versjon, children }: { versjon: string; children: ReactNode }) {
  const router = useRouter();
  const [bruker, setBruker] = useState<MegSvar | null>(null);
  const [aktivOrg, setAktivOrg] = useState<Org | null>(null);
  const [laster, setLaster] = useState(true);

  useEffect(() => {
    let avbrutt = false;
    meg
      .hent()
      .then((svar) => {
        if (avbrutt) return;
        setBruker(svar);
        setAktivOrg(velgStartOrg(svar.organisasjoner));
      })
      .catch(() => {
        // 401 håndteres av klienten, som allerede har sendt brukeren til innlogging.
        if (!avbrutt) router.replace("/logg-inn");
      })
      .finally(() => !avbrutt && setLaster(false));
    return () => {
      avbrutt = true;
    };
  }, [router]);

  const velgOrg = (orgId: string) => {
    const org = bruker?.organisasjoner.find((o) => o.id === orgId);
    if (!org) return;
    localStorage.setItem("aktivOrgId", orgId);
    setAktivOrg(org);
  };

  return (
    <OktKontekst.Provider value={{ bruker, aktivOrg, velgOrg, versjon, laster }}>
      {children}
    </OktKontekst.Provider>
  );
}
