/**
 * Regnskapskoblingen sett fra resten av appen — uavhengig av hvilket system som er koblet.
 *
 * `hentRegnskap()` sier hva orgen er koblet til og om det kan fakturere; `adapterFor()`
 * gir fakturaadapteret. Nye systemer (Tripletex …) legges til i `ADAPTERE` og i
 * `REGNSKAPSSYSTEMER` (`regnskap.ts`) — ingen kallsteder skal vite om Fiken.
 *
 * Kjøringene (`okonomi.ts`, `ladekjoring.ts`) bygger linjene; adapteret gjør dem til
 * fakturaer og svarer med referansene. Idempotensen er kjøringens `orderReference`, som
 * adapteret slår opp før det oppretter noe — en kjøring kan sendes på nytt etter en feil
 * uten dobbeltfakturering.
 */

import type { Db } from "../db/client";
import { ApiFeil } from "./api";
import { fikenFakturaadapter } from "./fikenfaktura";
import { fikenRad } from "./fikenkobling";
import { REGNSKAPSSYSTEMER, type RegnskapsSystem, type Regnskapsstatus } from "./regnskap";

/** Én faktura å opprette — det kjøringen vet, uten regnskapsspesifikke felt. */
export type Fakturaoppdrag = {
  /** Linjas id i kjøringen — svaret refererer tilbake til den. */
  linjeId: string;
  /** Mottakerens stabile nøkkel hos regnskapssystemet (seksjonens id → medlemsnummer). */
  mottakerNokkel: string;
  mottakerNavn: string;
  mottakerEpost: string | null;
  orderReference: string;
  /** Én tekstlinje på fakturaen. */
  beskrivelse: string;
  /** Øre inkl. mva. */
  belopOre: number;
  issueDate: string;
  dueDate: string;
  incomeAccount: string;
};

export type Fakturasvar = {
  linjeId: string;
  externalRef: string;
  externalNumber: string | null;
  /** Om fakturaen ble sendt til mottakeren (e-post), ikke bare opprettet. */
  sendt: boolean;
};

export type Fakturaadapter = {
  system: RegnskapsSystem;
  /** Oppretter og sender fakturaene, én om gangen, og svarer for hver. Kaster ved feil; det som er gjort er idempotent. */
  sendFakturaer(db: Db, orgId: string, oppdrag: Fakturaoppdrag[], opts: { tittel: string }): Promise<Fakturasvar[]>;
};

const ADAPTERE: Partial<Record<RegnskapsSystem, Fakturaadapter>> = {
  fiken: fikenFakturaadapter,
};

/** Hvilket system orgen er koblet til. Fiken er det eneste som finnes i dag; Tripletex kommer hit. */
export async function hentRegnskap(db: Db, orgId: string): Promise<Regnskapsstatus> {
  const fiken = await fikenRad(db, orgId);
  if (fiken) {
    const adapter = ADAPTERE.fiken;
    return {
      system: "fiken",
      navn: REGNSKAPSSYSTEMER.fiken.navn,
      foretak: fiken.companyName,
      kanFakturere: Boolean(adapter),
      grunn: adapter ? null : "Fakturasending til Fiken er ikke bygget ennå — last ned CSV",
    };
  }
  return { system: null, navn: "regnskapet", foretak: null, kanFakturere: false, grunn: "Ingen regnskapskobling — koble til under Økonomi → Integrasjon, eller last ned CSV" };
}

export async function adapterFor(db: Db, orgId: string): Promise<Fakturaadapter> {
  const status = await hentRegnskap(db, orgId);
  if (!status.system) throw new ApiFeil(400, status.grunn ?? "Ingen regnskapskobling");
  const adapter = ADAPTERE[status.system];
  if (!adapter) throw new ApiFeil(400, status.grunn ?? `${status.navn} kan ikke fakturere herfra ennå`);
  return adapter;
}
