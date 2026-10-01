/**
 * Typene og småkomponentene kundedetaljens faner deler. Egen fil fordi siden ble delt i
 * én fil per fane, og fanene ellers måtte importert fra `page.tsx`.
 */

import type { Trinn } from "@/lib/prisregler";

export type Kunde = {
  id: string;
  name: string;
  orgNr: string | null;
  orgForm: string | null;
  municipality: string | null;
  unitCount: number | null;
  active: boolean;
  enabledModules: string | null;
  antallOppgaver: number;
  antallAvvik: number;
  maksTimer: number;
  brukere: Array<{
    id: string;
    navn: string;
    epost: string;
    nivaa: string;
    sistInnlogget: string | null;
  }>;
  sesjoner: Array<{
    id: string;
    adminName: string | null;
    reason: string;
    startedAt: string;
    expiresAt: string | null;
    endedAt: string | null;
  }>;
};

export type Org = {
  id: string;
  name: string;
  slug: string;
  orgNr: string | null;
  orgForm: string | null;
  municipality: string | null;
  unitCount: number | null;
  active: boolean;
  demo: boolean;
  hasEmployees: boolean;
  phone: string | null;
  contactEmail: string | null;
  website: string | null;
  storageQuota: number | null;
  createdAt: string | null;
  affiliationType: string | null;
  bblId: string | null;
  bblNavn: string | null;
  managerType: string | null;
  managerBblId: string | null;
  managerBblNavn: string | null;
  managerName: string | null;
  managerOrgNr: string | null;
};

export type Abonnement = {
  baseFee: number | null;
  annualFee: number | null;
  discountPercent: number;
  startDate: string | null;
  endDate: string | null;
  notes: string | null;
  moduler: Array<{ key: string; price: number }>;
} | null;

export type Detalj = {
  org: Org;
  moduler: string[];
  abonnement: Abonnement;
  onboarding: {
    prosent: number;
    tellinger: { enheter: number; brukere: number; kontrakter: number };
    punkter: Array<{ nokkel: string; etikett: string; ok: boolean; detalj?: string | null }>;
  };
  prismodell: {
    gulvpris: number;
    trinn: Trinn[];
    modulpriser: Record<string, number>;
  };
  grunnpakkeNaa: number;
};


/** De tre fanene. Nøkkelen står i `?fane=`, så en lenke kan peke rett på en fane. */
export const FANER = ["oversikt", "abonnement", "tilgang"] as const;
export type Fane = (typeof FANER)[number];

/**
 * Nøklene fra da kundedetaljen hadde sju undersider. De lå aldri i URL-en, men et bokmerke
 * eller en lenke med `?fane=support` skal fortsatt lande riktig.
 */
const GAMLE_FANER: Record<string, Fane> = {
  sammendrag: "oversikt",
  organisasjon: "oversikt",
  onboarding: "oversikt",
  brukere: "tilgang",
  support: "tilgang",
  innsyn: "tilgang",
};

export function tolkFane(verdi: string | null): Fane {
  if (!verdi) return "oversikt";
  if ((FANER as readonly string[]).includes(verdi)) return verdi as Fane;
  return GAMLE_FANER[verdi] ?? "oversikt";
}

/** Én rad i et nøkkel/verdi-kort. Tom verdi vises som «Ikke satt», dempet og kursiv. */
export function Felt({ etikett, verdi }: { etikett: string; verdi: string | null | undefined }) {
  const tom = verdi === null || verdi === undefined || verdi.trim() === "";
  return (
    <div className="pf-felt">
      <span className="pf-under">{etikett}</span>
      <span className={tom ? "pf-ikke-satt" : undefined}>{tom ? "Ikke satt" : verdi}</span>
    </div>
  );
}
