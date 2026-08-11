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
    let sistHentet = 0;

    const hent = (forsteGang: boolean) => {
      sistHentet = Date.now();
      meg
        .hent()
        .then((svar) => {
          if (avbrutt) return;
          setBruker(svar);
          // Aktiv org PEKES PÅ NYTT inn i det ferske svaret — beholdt vi det gamle
          // objektet, ville modullista og tilgangsnivået i det vært et snapshot.
          setAktivOrg((forrige) => {
            const orgs = svar.organisasjoner;
            return (forrige && orgs.find((o) => o.id === forrige.id)) ?? velgStartOrg(orgs);
          });
        })
        .catch(() => {
          // 401 håndteres av klienten, som allerede har sendt brukeren til innlogging.
          if (!avbrutt && forsteGang) router.replace("/logg-inn");
        })
        .finally(() => !avbrutt && setLaster(false));
    };

    hent(true);

    /**
     * Stille gjenoppfriskning når fanen får fokus igjen (maks hvert minutt): skrur
     * plattformadmin av en modul, skal menypunktet være borte neste gang kunden ser på
     * fanen — ikke først ved neste harde sidelast. API-et gater uansett hvert kall, så
     * dette er visningen som henger etter, ikke tilgangen.
     */
    const vedFokus = () => {
      if (document.visibilityState === "visible" && Date.now() - sistHentet > 60_000) {
        hent(false);
      }
    };
    window.addEventListener("focus", vedFokus);
    document.addEventListener("visibilitychange", vedFokus);
    return () => {
      avbrutt = true;
      window.removeEventListener("focus", vedFokus);
      document.removeEventListener("visibilitychange", vedFokus);
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
