/**
 * Økonomimodulen — eierregister, budsjett, satser, halvårskjøringer og fakturagodkjenning.
 * Steg 1 i `docs/fiken.md` («Økonomi uten Fiken»): ingen ekstern avhengighet, selgbart
 * alene. Regnskapskoblingen kommer som adapter oppå de samme funksjonene.
 *
 * ## Fire regler som holdes her, ikke i rutene
 *
 * 1. **Vedtatt budsjett er låst.** Linjene kan ikke endres etter vedtak — satsene er regnet
 *    fra dem, og fakturaer er sendt. Skal noe endres, gjenåpnes budsjettet eksplisitt (og
 *    det logges).
 * 2. **Beregning rører aldri en overstyrt sats.** Ellers forsvinner garasjetillegget hver
 *    gang noen trykker «Beregn på nytt».
 * 3. **En kjøring kan ikke overlappe en annen** som ikke er annullert — dobbeltfakturering
 *    er den ene feilen eierne ikke tilgir.
 * 4. **Statusovergangene for fakturaer** står i `FAKTURA_OVERGANGER`; alt annet er 400.
 *
 * Alt med revisjonsverdi (vedtak, eierskifte, kjøring, godkjenning, avvisning) går i
 * hendelsesloggen i samme transaksjon.
 */

import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "../db/client";
import { contracts } from "../db/schema/kontrakter";
import {
  budgetLines,
  budgets,
  feeRunLines,
  feeRuns,
  supplierInvoices,
  unitFeeRates,
  unitOwners,
} from "../db/schema/okonomi";
import { units } from "../db/schema/units";
import { buildingElements } from "../db/schema/vedlikehold";
import { vendors } from "../db/schema/vendors";
import type { Aktor } from "./aktor";
import { ApiFeil, ikkeFunnet, ugyldig } from "./api";
import { enhetKortnavn, enhetNavn } from "./enhetnavn";
import { faktiskFraFiken } from "./fikenkobling";
import { loggHendelse } from "./hendelser";
import { lagreFil, slettFil } from "./lagring";
import {
  FAKTURA_OVERGANGER,
  FAKTURA_STATUSER,
  LINJETYPER,
  STANDARD_LINJER,
  VEDLIKEHOLD_KONTO,
  beregnSats,
  brokSum,
  budsjettSummer,
  erForfalt,
  forfallsdato,
  harBrok,
  isoDato,
  juster,
  kontoIIntervall,
  maanederAvAaret,
  manederI,
  ordreReferanse,
  periodeFor,
  tilCsv,
  tilKronerTekst,
  type FakturaStatus,
} from "./okonomiregler";

const MODUL = "okonomi" as const;
/** Mappen fakturavedleggene ligger i under `uploads/orgs/{orgId}/`. */
const FILMAPPE = "supplier_invoices";

/** Kun PDF og bilder — samme sett som kontrakter, av samme grunn. */
export const FAKTURA_TYPER = ["application/pdf", "image/png", "image/jpeg"] as const;
export const FAKTURA_MAKS = 25 * 1024 * 1024;

const tekst = z.string().trim().nullish();
/** Øre som heltall. Klienten konverterer med `tilOre()` før sending. */
const ore = z.number().int();

// =======================================================================================
// Eierregisteret
// =======================================================================================

export const eierInn = z.object({
  unitId: z.string().min(1, "Seksjon må velges"),
  name: z.string().trim().min(1, "Navn må fylles ut"),
  email: z.string().trim().email("Ugyldig e-postadresse").nullish().or(z.literal("").transform(() => null)),
  phone: tekst,
  invoiceAddress: tekst,
  ownerFrom: z.string().date(),
  note: tekst,
});

export const eierEndring = eierInn.omit({ unitId: true, ownerFrom: true }).partial();

export const brokInn = z.object({
  teller: z.number().int().min(0, "Teller kan ikke være negativ").nullable(),
  nevner: z.number().int().min(1, "Nevner må være minst 1").nullable(),
  /** BRA i m², som streng (numeric) — se `enhetInn`. Utelatt = urørt. */
  arealM2: z
    .union([z.string(), z.number()])
    .nullish()
    .transform((v) => (v === null || v === undefined ? v : String(v)))
    .optional(),
});

async function hentBoliger(db: Db, orgId: string) {
  return db
    .select()
    .from(units)
    .where(and(eq(units.orgId, orgId), isNull(units.archivedAt), ne(units.type, "fellesareal")))
    .orderBy(asc(units.andelsnr), asc(units.oppgang), asc(units.leilighetsnr));
}

async function krevEnhetIOrg(db: Db, orgId: string, unitId: string) {
  const r = await db
    .select()
    .from(units)
    .where(and(eq(units.id, unitId), eq(units.orgId, orgId)))
    .limit(1);
  if (!r[0]) throw ikkeFunnet("Seksjon");
  return r[0];
}

/** Eieren av en seksjon på en gitt dato — `ownerFrom ≤ dato < ownerTo` (eller uten slutt). */
export function eierPaaDato<T extends { unitId: string; ownerFrom: string; ownerTo: string | null }>(
  eiere: ReadonlyArray<T>,
  unitId: string,
  dato: string,
): T | null {
  let treff: T | null = null;
  for (const e of eiere) {
    if (e.unitId !== unitId) continue;
    if (e.ownerFrom > dato) continue;
    if (e.ownerTo !== null && e.ownerTo < dato) continue;
    // Flere kandidater (feilregistrering): den med senest start vinner.
    if (!treff || e.ownerFrom > treff.ownerFrom) treff = e;
  }
  return treff;
}

/**
 * Seksjonene med nåværende eier og brøk — eierregisteret slik det vises. Fellesarealer er
 * ikke med: de har verken eier eller brøk.
 */
export async function hentEiere(db: Db, orgId: string) {
  const [boliger, eiere, satser] = await Promise.all([
    hentBoliger(db, orgId),
    db
      .select()
      .from(unitOwners)
      .where(eq(unitOwners.orgId, orgId))
      .orderBy(desc(unitOwners.ownerFrom)),
    db.select().from(unitFeeRates).where(eq(unitFeeRates.orgId, orgId)),
  ]);

  const iDag = isoDato(new Date());
  const seksjoner = boliger.map((u) => {
    const naa = eiere.find((e) => e.unitId === u.id && e.ownerTo === null) ?? eierPaaDato(eiere, u.id, iDag);
    return {
      unitId: u.id,
      /** Kortformen — oppgangen ligger i egen kolonne. */
      navn: enhetKortnavn(u),
      andelsnr: u.andelsnr,
      leilighetsnr: u.leilighetsnr,
      oppgang: u.oppgang,
      /** `numeric` kommer som streng — se `enhetInn` i lib/enheter.ts. */
      arealM2: u.arealM2,
      brokTeller: u.brokTeller,
      brokNevner: u.brokNevner,
      eier: naa,
      antallTidligere: eiere.filter((e) => e.unitId === u.id && e.id !== naa?.id).length,
      /** Gjeldende felleskostnadssats per måned (øre), eller null uten sats. */
      satsMnd: satsPaaDato(satser, u.id, iDag)?.monthlyAmount ?? null,
    };
  });

  const sum = brokSum(boliger.map((u) => ({ teller: u.brokTeller, nevner: u.brokNevner })));
  return {
    seksjoner,
    brokSum: sum,
    utenBrok: boliger.filter((u) => !harBrok({ teller: u.brokTeller, nevner: u.brokNevner })).length,
    utenEier: seksjoner.filter((s) => !s.eier).length,
    satsSumMnd: seksjoner.reduce((s, r) => s + (r.satsMnd ?? 0), 0),
  };
}

export async function hentEierhistorikk(db: Db, orgId: string, unitId: string) {
  await krevEnhetIOrg(db, orgId, unitId);
  return db
    .select()
    .from(unitOwners)
    .where(and(eq(unitOwners.orgId, orgId), eq(unitOwners.unitId, unitId)))
    .orderBy(desc(unitOwners.ownerFrom));
}

/** Dagen før en ISO-dato. */
function dagenFor(dato: string): string {
  const d = new Date(`${dato}T12:00:00`);
  d.setDate(d.getDate() - 1);
  return isoDato(d);
}

/**
 * Registrerer eier — og gjør EIERSKIFTE hvis seksjonen alt har en. Den gamle eieren
 * arkiveres med `ownerTo` dagen før den nye overtar; raden slettes aldri, siden
 * fakturagrunnlag fra før skiftet peker på den.
 */
export async function registrerEier(db: Db, orgId: string, av: Aktor, data: z.infer<typeof eierInn>) {
  const enhet = await krevEnhetIOrg(db, orgId, data.unitId);
  if (enhet.type === "fellesareal") throw ugyldig("Et fellesareal har ingen eier.");

  const naa = await db
    .select()
    .from(unitOwners)
    .where(and(eq(unitOwners.orgId, orgId), eq(unitOwners.unitId, data.unitId), isNull(unitOwners.ownerTo)))
    .limit(1);

  let hendelse: string;
  if (naa[0]) {
    if (data.ownerFrom <= naa[0].ownerFrom) {
      throw ugyldig(
        `Overtakelsesdatoen må være etter nåværende eiers startdato (${naa[0].ownerFrom}).`,
      );
    }
    await db
      .update(unitOwners)
      .set({ ownerTo: dagenFor(data.ownerFrom) })
      .where(and(eq(unitOwners.id, naa[0].id), eq(unitOwners.orgId, orgId)));
    hendelse = `Eierskifte på ${enhetNavn(enhet)}: ${naa[0].name} → ${data.name} fra ${data.ownerFrom}`;
  } else {
    hendelse = `Registrerte ${data.name} som eier av ${enhetNavn(enhet)} fra ${data.ownerFrom}`;
  }

  const [ny] = await db
    .insert(unitOwners)
    .values({ id: randomUUID(), orgId, ...data, email: data.email ?? null })
    .returning();
  await loggHendelse(db, orgId, av, { modul: MODUL, entitet: "eier", entitetId: ny!.id, hendelse });
  return ny!;
}

async function hentEier(db: Db, orgId: string, ownerId: string) {
  const r = await db
    .select()
    .from(unitOwners)
    .where(and(eq(unitOwners.id, ownerId), eq(unitOwners.orgId, orgId)))
    .limit(1);
  if (!r[0]) throw ikkeFunnet("Eier");
  return r[0];
}

/** Retting av kontaktopplysninger — ikke eierskifte. Datoene røres ikke her. */
export async function endreEier(db: Db, orgId: string, ownerId: string, data: z.infer<typeof eierEndring>) {
  await hentEier(db, orgId, ownerId);
  const [endret] = await db
    .update(unitOwners)
    .set(data)
    .where(and(eq(unitOwners.id, ownerId), eq(unitOwners.orgId, orgId)))
    .returning();
  return endret!;
}

/**
 * Sletting er for feilregistreringer. Var raden nåværende eier, gjenåpnes forrige eier
 * (hens `ownerTo` nulles) — ellers står seksjonen uten eier etter en angret feiltasting.
 * Fakturalinjer som pekte hit får `owner_id = NULL` (FK), men beholder navnet.
 */
export async function slettEier(db: Db, orgId: string, ownerId: string, av: Aktor) {
  const eier = await hentEier(db, orgId, ownerId);
  await db.delete(unitOwners).where(and(eq(unitOwners.id, ownerId), eq(unitOwners.orgId, orgId)));

  if (eier.ownerTo === null) {
    const forrige = await db
      .select()
      .from(unitOwners)
      .where(and(eq(unitOwners.orgId, orgId), eq(unitOwners.unitId, eier.unitId)))
      .orderBy(desc(unitOwners.ownerFrom))
      .limit(1);
    if (forrige[0]) {
      await db
        .update(unitOwners)
        .set({ ownerTo: null })
        .where(and(eq(unitOwners.id, forrige[0].id), eq(unitOwners.orgId, orgId)));
    }
  }
  await loggHendelse(db, orgId, av, {
    modul: MODUL, entitet: "eier", entitetId: ownerId,
    hendelse: `Slettet eierregistreringen for ${eier.name}`,
  });
}

/** Brøken (og BRA) settes på seksjonen — de er egenskaper ved seksjonen, ikke eieren. */
export async function settBrok(db: Db, orgId: string, unitId: string, data: z.infer<typeof brokInn>) {
  const enhet = await krevEnhetIOrg(db, orgId, unitId);
  if (enhet.type === "fellesareal") throw ugyldig("Et fellesareal har ingen brøk.");
  if ((data.teller === null) !== (data.nevner === null)) {
    throw ugyldig("Brøken må ha både teller og nevner — eller ingen av delene.");
  }
  const [endret] = await db
    .update(units)
    .set({
      brokTeller: data.teller,
      brokNevner: data.nevner,
      ...(data.arealM2 === undefined ? {} : { arealM2: data.arealM2 }),
    })
    .where(and(eq(units.id, unitId), eq(units.orgId, orgId)))
    .returning();
  return endret!;
}

/**
 * Alt seksjonsmodalen viser om ÉN seksjon: fysiske fakta, nåværende og tidligere eiere,
 * satsene, fakturagrunnlaget måned for måned, og en tidslinje regnet ut av det samme —
 * eierskifter, satsendringer og kjøringer. Ingen egen historikktabell: tidslinja er
 * dataene selv, så den kan aldri sprike fra dem.
 */
export async function hentSeksjon(db: Db, orgId: string, unitId: string) {
  const enhet = await krevEnhetIOrg(db, orgId, unitId);
  const [eiere, satser, linjer] = await Promise.all([
    db
      .select()
      .from(unitOwners)
      .where(and(eq(unitOwners.orgId, orgId), eq(unitOwners.unitId, unitId)))
      .orderBy(desc(unitOwners.ownerFrom)),
    db
      .select()
      .from(unitFeeRates)
      .where(and(eq(unitFeeRates.orgId, orgId), eq(unitFeeRates.unitId, unitId)))
      .orderBy(desc(unitFeeRates.validFrom)),
    db
      .select({ linje: feeRunLines, status: feeRuns.status, kjoringOpprettet: feeRuns.createdAt, kjoringAv: feeRuns.createdBy })
      .from(feeRunLines)
      .innerJoin(feeRuns, eq(feeRuns.id, feeRunLines.feeRunId))
      .where(and(eq(feeRunLines.orgId, orgId), eq(feeRunLines.unitId, unitId), ne(feeRuns.status, "annullert")))
      .orderBy(desc(feeRunLines.month)),
  ]);

  const iDag = isoDato(new Date());
  const eier = eiere.find((e) => e.ownerTo === null) ?? eierPaaDato(eiere, unitId, iDag);
  const sats = satsPaaDato(satser, unitId, iDag);

  type Hendelse = { dato: string; tone: "ok" | "info" | "warn" | "muted"; tittel: string; detalj: string };
  const historikk: Hendelse[] = [];
  for (const e of eiere) {
    historikk.push({ dato: e.ownerFrom, tone: "ok", tittel: `Ny eier: ${e.name}`, detalj: e.ownerTo ? `til ${e.ownerTo}` : "nåværende eier" });
    if (e.ownerTo) historikk.push({ dato: e.ownerTo, tone: "muted", tittel: `${e.name} avsluttet som eier`, detalj: "eierskifte" });
  }
  for (const s of satser) {
    historikk.push({
      dato: s.validFrom, tone: "info",
      tittel: `Felleskostnad ${tilKronerTekst(s.monthlyAmount)} kr/mnd`,
      detalj: s.source === "overstyrt" ? `satt manuelt${s.note ? ` · ${s.note}` : ""}` : "beregnet fra vedtatt budsjett",
    });
  }
  const perKjoring = new Map<string, { forste: string; siste: string; sum: number; antall: number; av: string; opprettet: Date; status: string }>();
  for (const l of linjer) {
    const k = perKjoring.get(l.linje.feeRunId) ?? { forste: l.linje.month, siste: l.linje.month, sum: 0, antall: 0, av: l.kjoringAv, opprettet: l.kjoringOpprettet, status: l.status };
    k.forste = l.linje.month < k.forste ? l.linje.month : k.forste;
    k.siste = l.linje.month > k.siste ? l.linje.month : k.siste;
    k.sum += l.linje.amount;
    k.antall++;
    perKjoring.set(l.linje.feeRunId, k);
  }
  for (const k of perKjoring.values()) {
    historikk.push({
      dato: isoDato(k.opprettet), tone: k.status === "sendt" ? "ok" : "info",
      tittel: `Fakturagrunnlag ${k.forste.slice(0, 7)} – ${k.siste.slice(0, 7)}`,
      detalj: `${k.antall} måneder · ${tilKronerTekst(k.sum)} kr · laget av ${k.av}`,
    });
  }
  historikk.sort((a, b) => b.dato.localeCompare(a.dato));

  return {
    unitId: enhet.id,
    navn: enhetKortnavn(enhet),
    fulltNavn: enhetNavn(enhet),
    type: enhet.type,
    andelsnr: enhet.andelsnr,
    leilighetsnr: enhet.leilighetsnr,
    oppgang: enhet.oppgang,
    etasje: enhet.etasje,
    arealM2: enhet.arealM2,
    brokTeller: enhet.brokTeller,
    brokNevner: enhet.brokNevner,
    eier,
    tidligere: eiere.filter((e) => e.id !== eier?.id),
    sats,
    satser,
    fakturalinjer: linjer.map((l) => ({ ...l.linje, kjoringStatus: l.status })),
    historikk,
  };
}

// =======================================================================================
// Budsjett
// =======================================================================================

export const budsjettInn = z.object({
  year: z.number().int().min(2000).max(2100),
  note: tekst,
  /** Kopier linjene fra et annet budsjett (typisk i fjor) i stedet for standardlinjene. */
  kopierFraId: z.string().nullish(),
  /** Prisstigning lagt på alle kopierte beløp, i prosent. Ignoreres uten `kopierFraId`. */
  justerProsent: z.number().min(-100).max(100).nullish(),
});

export const budsjettEndring = z.object({ note: tekst });

export const vedtakInn = z.object({ adoptedDate: z.string().date() });

export const linjeInn = z.object({
  kind: z.enum(LINJETYPER),
  name: z.string().trim().min(1, "Linja må ha et navn"),
  accountFrom: z.number().int().min(1000).max(9999).nullish(),
  accountTo: z.number().int().min(1000).max(9999).nullish(),
  amount: ore.min(0, "Beløpet kan ikke være negativt").default(0),
  note: tekst,
  sortOrder: z.number().int().optional(),
});

export const linjeEndring = linjeInn.partial();

/** «Faktisk» per budsjettlinje: godkjente og betalte fakturaer knyttet til linja. */
async function faktiskPerLinje(db: Db, orgId: string, budgetId: string): Promise<Map<string, number>> {
  const rader = await db
    .select({
      linjeId: supplierInvoices.budgetLineId,
      sum: sql<string>`coalesce(sum(${supplierInvoices.amount}), 0)::bigint`,
    })
    .from(supplierInvoices)
    .innerJoin(budgetLines, eq(budgetLines.id, supplierInvoices.budgetLineId))
    .where(
      and(
        eq(supplierInvoices.orgId, orgId),
        eq(budgetLines.budgetId, budgetId),
        inArray(supplierInvoices.status, ["godkjent", "betalt"]),
      ),
    )
    .groupBy(supplierInvoices.budgetLineId);
  // bigint kommer som STRENG fra node-postgres — Number() før noe regnes.
  return new Map(rader.filter((r) => r.linjeId).map((r) => [r.linjeId!, Number(r.sum)]));
}

export async function hentBudsjetter(db: Db, orgId: string) {
  const [rader, linjer] = await Promise.all([
    db.select().from(budgets).where(eq(budgets.orgId, orgId)).orderBy(desc(budgets.year)),
    db.select().from(budgetLines).where(eq(budgetLines.orgId, orgId)),
  ]);
  return rader.map((b) => ({
    ...b,
    summer: budsjettSummer(linjer.filter((l) => l.budgetId === b.id)),
    antallLinjer: linjer.filter((l) => l.budgetId === b.id).length,
  }));
}

export async function hentBudsjett(db: Db, orgId: string, budgetId: string) {
  const r = await db
    .select()
    .from(budgets)
    .where(and(eq(budgets.id, budgetId), eq(budgets.orgId, orgId)))
    .limit(1);
  const b = r[0];
  if (!b) throw ikkeFunnet("Budsjett");

  const linjer = await db
    .select()
    .from(budgetLines)
    .where(and(eq(budgetLines.budgetId, budgetId), eq(budgetLines.orgId, orgId)))
    .orderBy(asc(budgetLines.sortOrder), asc(budgetLines.createdAt));

  // Med regnskapskobling er REGNSKAPET fasit for «faktisk» (kjøp per konto); uten er det
  // fakturaene styret har godkjent her. Aldri begge — en faktura godkjent i DriftIQ og
  // bokført i Fiken er samme kostnad.
  const fraFiken = await faktiskFraFiken(db, orgId, b.year, linjer);
  const faktisk = fraFiken ?? (await faktiskPerLinje(db, orgId, budgetId));

  const medFaktisk = linjer.map((l) => ({ ...l, faktisk: faktisk.get(l.id) ?? 0 }));
  return {
    ...b,
    linjer: medFaktisk,
    summer: budsjettSummer(linjer),
    faktiskKostnader: medFaktisk.filter((l) => l.kind === "kostnad").reduce((s, l) => s + l.faktisk, 0),
    /** Hvor «faktisk» kommer fra — vises på budsjettet. */
    faktiskKilde: (fraFiken ? "fiken" : "fakturaer") as "fiken" | "fakturaer",
  };
}

export async function opprettBudsjett(db: Db, orgId: string, av: Aktor, data: z.infer<typeof budsjettInn>) {
  const finnes = await db
    .select({ id: budgets.id })
    .from(budgets)
    .where(and(eq(budgets.orgId, orgId), eq(budgets.year, data.year)))
    .limit(1);
  if (finnes[0]) throw ugyldig(`Det finnes allerede et budsjett for ${data.year}.`);

  let mal: Array<{ kind: string; name: string; accountFrom: number | null; accountTo: number | null; amount: number; note: string | null }>;
  if (data.kopierFraId) {
    const kilde = await hentBudsjett(db, orgId, data.kopierFraId);
    mal = kilde.linjer.map((l) => ({
      kind: l.kind, name: l.name, accountFrom: l.accountFrom, accountTo: l.accountTo,
      amount: juster(l.amount, data.justerProsent ?? 0), note: l.note,
    }));
  } else {
    mal = STANDARD_LINJER.map((l) => ({ ...l, amount: 0, note: null }));
  }

  const [ny] = await db
    .insert(budgets)
    .values({ id: randomUUID(), orgId, year: data.year, note: data.note ?? null })
    .returning();
  if (mal.length > 0) {
    await db.insert(budgetLines).values(
      mal.map((l, i) => ({ id: randomUUID(), orgId, budgetId: ny!.id, ...l, sortOrder: i })),
    );
  }
  await loggHendelse(db, orgId, av, {
    modul: MODUL, entitet: "budsjett", entitetId: ny!.id,
    hendelse: `Opprettet budsjett for ${data.year}${data.kopierFraId ? ` (kopi av tidligere år${data.justerProsent ? `, justert ${data.justerProsent} %` : ""})` : ""}`,
  });
  return hentBudsjett(db, orgId, ny!.id);
}

async function krevUtkast(db: Db, orgId: string, budgetId: string) {
  const b = await hentBudsjett(db, orgId, budgetId);
  if (b.status === "vedtatt") {
    throw new ApiFeil(409, "Budsjettet er vedtatt og kan ikke endres. Gjenåpne det først.");
  }
  return b;
}

export async function endreBudsjett(db: Db, orgId: string, budgetId: string, data: z.infer<typeof budsjettEndring>) {
  await hentBudsjett(db, orgId, budgetId);
  await db
    .update(budgets)
    .set({ note: data.note ?? null, updatedAt: new Date() })
    .where(and(eq(budgets.id, budgetId), eq(budgets.orgId, orgId)));
  return hentBudsjett(db, orgId, budgetId);
}

/** Stempler budsjettet som endret — kalles av alt som rører linjene eller statusen. */
async function merkEndret(db: Db, orgId: string, budgetId: string) {
  await db
    .update(budgets)
    .set({ updatedAt: new Date() })
    .where(and(eq(budgets.id, budgetId), eq(budgets.orgId, orgId)));
}

/** Bare utkast kan slettes — et vedtatt budsjett er dokumentasjon. */
export async function slettBudsjett(db: Db, orgId: string, budgetId: string, av: Aktor) {
  const b = await krevUtkast(db, orgId, budgetId);
  await db.delete(budgets).where(and(eq(budgets.id, budgetId), eq(budgets.orgId, orgId)));
  await loggHendelse(db, orgId, av, {
    modul: MODUL, entitet: "budsjett", entitetId: budgetId, hendelse: `Slettet budsjettutkastet for ${b.year}`,
  });
}

export async function vedtaBudsjett(db: Db, orgId: string, budgetId: string, av: Aktor, data: z.infer<typeof vedtakInn>) {
  const b = await hentBudsjett(db, orgId, budgetId);
  if (b.status === "vedtatt") throw new ApiFeil(409, "Budsjettet er allerede vedtatt.");
  if (b.summer.felleskost <= 0) {
    throw ugyldig("Budsjettet må ha et felleskostnadsbeløp større enn 0 før det kan vedtas.");
  }
  await db
    .update(budgets)
    .set({ status: "vedtatt", adoptedDate: data.adoptedDate, updatedAt: new Date() })
    .where(and(eq(budgets.id, budgetId), eq(budgets.orgId, orgId)));
  await loggHendelse(db, orgId, av, {
    modul: MODUL, entitet: "budsjett", entitetId: budgetId,
    hendelse: `Vedtok budsjettet for ${b.year} (årsmøte ${data.adoptedDate}), felleskostnader ${tilKronerTekst(b.summer.felleskost)} kr`,
  });
  return hentBudsjett(db, orgId, budgetId);
}

export async function gjenapneBudsjett(db: Db, orgId: string, budgetId: string, av: Aktor) {
  const b = await hentBudsjett(db, orgId, budgetId);
  if (b.status !== "vedtatt") throw new ApiFeil(409, "Budsjettet er ikke vedtatt.");
  await db
    .update(budgets)
    .set({ status: "utkast", adoptedDate: null, updatedAt: new Date() })
    .where(and(eq(budgets.id, budgetId), eq(budgets.orgId, orgId)));
  await loggHendelse(db, orgId, av, {
    modul: MODUL, entitet: "budsjett", entitetId: budgetId, hendelse: `Gjenåpnet budsjettet for ${b.year}`,
  });
  return hentBudsjett(db, orgId, budgetId);
}

function validerKonto(l: { accountFrom?: number | null; accountTo?: number | null }) {
  if (l.accountFrom != null && l.accountTo != null && l.accountTo < l.accountFrom) {
    throw ugyldig("Kontointervallet må gå fra lavest til høyest.");
  }
  if (l.accountFrom == null && l.accountTo != null) {
    throw ugyldig("Kontointervallet må ha en fra-konto.");
  }
}

export async function leggTilLinje(db: Db, orgId: string, budgetId: string, data: z.infer<typeof linjeInn>) {
  const b = await krevUtkast(db, orgId, budgetId);
  validerKonto(data);
  const [ny] = await db
    .insert(budgetLines)
    .values({
      id: randomUUID(), orgId, budgetId, ...data,
      sortOrder: data.sortOrder ?? b.linjer.length,
    })
    .returning();
  await merkEndret(db, orgId, budgetId);
  return ny!;
}

export async function endreLinje(db: Db, orgId: string, budgetId: string, lineId: string, data: z.infer<typeof linjeEndring>) {
  const b = await krevUtkast(db, orgId, budgetId);
  const linje = b.linjer.find((l) => l.id === lineId);
  if (!linje) throw ikkeFunnet("Budsjettlinje");
  validerKonto({ ...linje, ...data });
  const [endret] = await db
    .update(budgetLines)
    .set(data)
    .where(and(eq(budgetLines.id, lineId), eq(budgetLines.orgId, orgId)))
    .returning();
  await merkEndret(db, orgId, budgetId);
  return endret!;
}

export async function slettLinje(db: Db, orgId: string, budgetId: string, lineId: string) {
  const b = await krevUtkast(db, orgId, budgetId);
  if (!b.linjer.some((l) => l.id === lineId)) throw ikkeFunnet("Budsjettlinje");
  await db.delete(budgetLines).where(and(eq(budgetLines.id, lineId), eq(budgetLines.orgId, orgId)));
  await merkEndret(db, orgId, budgetId);
}

// ---------------------------------------------------------------------------------------
// Forslag fra avtalene
// ---------------------------------------------------------------------------------------

export const forslagInn = z.object({
  linjer: z
    .array(z.object({ lineId: z.string().min(1), amount: ore.min(0) }))
    .min(1, "Ingen linjer å oppdatere"),
});

/**
 * Forslag til beløp per budsjettlinje, regnet fra det som alt ligger i systemet:
 *
 * - **Avtaler** (kontrakter) med konto og årssum: legges på linja hvis intervall dekker
 *   kontoen, forholdsmessig etter hvor mange av budsjettårets måneder avtalen gjelder.
 *   Arkiverte avtaler er ikke med; en avtale som utløper i mars teller tre måneder.
 * - **Vedlikeholdsplanen**: bygningsdeler med tiltak i budsjettåret og estimert kostnad,
 *   på linja som dekker `VEDLIKEHOLD_KONTO`.
 * - **Fjorårets budsjett og faktisk** for samme kontointervall, til sammenligning — ikke
 *   som del av forslaget.
 *
 * `prosent` er justeringen styret velger (prisstigning). Forslaget ERSTATTER ingenting —
 * `brukForslag` skriver først når styret har sett tallene. Kontrakter lagrer kroner,
 * økonomi lagrer øre; konverteringen skjer her og bare her.
 */
export async function foreslaBudsjett(db: Db, orgId: string, budgetId: string, prosent = 0) {
  const b = await hentBudsjett(db, orgId, budgetId);
  const [avtaler, deler, fjor] = await Promise.all([
    db
      .select()
      .from(contracts)
      .where(and(eq(contracts.orgId, orgId), isNull(contracts.archivedAt)))
      .orderBy(asc(contracts.title)),
    db
      .select()
      .from(buildingElements)
      .where(and(eq(buildingElements.orgId, orgId), eq(buildingElements.nextActionYear, b.year))),
    db
      .select({ id: budgets.id })
      .from(budgets)
      .where(and(eq(budgets.orgId, orgId), eq(budgets.year, b.year - 1)))
      .limit(1),
  ]);
  const fjoraaret = fjor[0] ? await hentBudsjett(db, orgId, fjor[0].id) : null;

  const brukt = new Set<string>();
  const linjer = b.linjer.map((l) => {
    const kilder: Array<{ slag: "avtale" | "vedlikehold"; navn: string; belop: number; maaneder: number }> = [];
    if (l.kind === "kostnad" && l.accountFrom != null) {
      for (const a of avtaler) {
        if (!a.annualSum || !kontoIIntervall(a.account, l.accountFrom, l.accountTo)) continue;
        const maaneder = maanederAvAaret(a.startDate, a.endDate, b.year);
        if (maaneder === 0) continue;
        brukt.add(a.id);
        kilder.push({ slag: "avtale", navn: a.title, belop: Math.round((a.annualSum * 100 * maaneder) / 12), maaneder });
      }
      if (kontoIIntervall(VEDLIKEHOLD_KONTO, l.accountFrom, l.accountTo)) {
        for (const d of deler) {
          if (!d.estimatedCost) continue;
          kilder.push({ slag: "vedlikehold", navn: d.name, belop: d.estimatedCost * 100, maaneder: 12 });
        }
      }
    }
    const grunnlag = kilder.reduce((s, k) => s + k.belop, 0);
    const fjorLinje = fjoraaret?.linjer.find(
      (f) => f.kind === l.kind && f.accountFrom === l.accountFrom && (f.accountTo ?? f.accountFrom) === (l.accountTo ?? l.accountFrom),
    ) ?? null;
    return {
      lineId: l.id, name: l.name, kind: l.kind, accountFrom: l.accountFrom, accountTo: l.accountTo,
      naavaerende: l.amount,
      grunnlag,
      forslag: kilder.length > 0 ? juster(grunnlag, prosent) : null,
      kilder,
      fjoraretsBudsjett: fjorLinje?.amount ?? null,
      fjoraretsFaktisk: fjorLinje ? fjorLinje.faktisk : null,
    };
  });

  const utenom = avtaler
    .filter((a) => !brukt.has(a.id))
    .map((a) => ({
      id: a.id,
      title: a.title,
      grunn: !a.annualSum
        ? "mangler årssum"
        : a.account == null
          ? "mangler konto"
          : maanederAvAaret(a.startDate, a.endDate, b.year) === 0
            ? `gjelder ikke i ${b.year}`
            : `konto ${a.account} treffer ingen budsjettlinje`,
    }));

  return { prosent, linjer, utenom };
}

/** Skriver de beløpene styret godtok. Bare utkast; logges som én hendelse. */
export async function brukForslag(db: Db, orgId: string, budgetId: string, av: Aktor, data: z.infer<typeof forslagInn>) {
  const b = await krevUtkast(db, orgId, budgetId);
  let endret = 0;
  for (const v of data.linjer) {
    const linje = b.linjer.find((l) => l.id === v.lineId);
    if (!linje) throw ikkeFunnet("Budsjettlinje");
    if (linje.amount === v.amount) continue;
    await db
      .update(budgetLines)
      .set({ amount: v.amount })
      .where(and(eq(budgetLines.id, v.lineId), eq(budgetLines.orgId, orgId)));
    endret++;
  }
  if (endret > 0) await merkEndret(db, orgId, budgetId);
  await loggHendelse(db, orgId, av, {
    modul: MODUL, entitet: "budsjett", entitetId: budgetId,
    hendelse: `Oppdaterte ${endret} ${endret === 1 ? "budsjettlinje" : "budsjettlinjer"} for ${b.year} fra forslaget basert på avtaler og vedlikeholdsplan`,
  });
  return hentBudsjett(db, orgId, budgetId);
}

// =======================================================================================
// Satser
// =======================================================================================

export const satsInn = z.object({
  monthlyAmount: ore.min(0, "Satsen kan ikke være negativ"),
  validFrom: z.string().date(),
  note: tekst,
});

/** Satsen som gjelder på en dato: nyeste `validFrom ≤ dato`. */
export function satsPaaDato<T extends { unitId: string; validFrom: string }>(
  satser: ReadonlyArray<T>,
  unitId: string,
  dato: string,
): T | null {
  let treff: T | null = null;
  for (const s of satser) {
    if (s.unitId !== unitId || s.validFrom > dato) continue;
    if (!treff || s.validFrom > treff.validFrom) treff = s;
  }
  return treff;
}

/**
 * Satsene per seksjon slik de gjelder på `dato` (standard i dag), med det som skal til for
 * å se hvorfor: brøk, hvilket budsjett, beregnet eller overstyrt, og eieren.
 */
export async function hentSatser(db: Db, orgId: string, dato = isoDato(new Date())) {
  const [boliger, satser, eiere] = await Promise.all([
    hentBoliger(db, orgId),
    db.select().from(unitFeeRates).where(eq(unitFeeRates.orgId, orgId)),
    db.select().from(unitOwners).where(eq(unitOwners.orgId, orgId)),
  ]);

  const rader = boliger.map((u) => {
    const sats = satsPaaDato(satser, u.id, dato);
    const eier = eierPaaDato(eiere, u.id, dato);
    return {
      unitId: u.id,
      navn: enhetKortnavn(u),
      oppgang: u.oppgang,
      brokTeller: u.brokTeller,
      brokNevner: u.brokNevner,
      eierNavn: eier?.name ?? null,
      sats,
      /** Alle satsene for seksjonen — historikk og fremtidige. */
      alle: satser.filter((s) => s.unitId === u.id).sort((a, b) => b.validFrom.localeCompare(a.validFrom)),
    };
  });

  return {
    dato,
    rader,
    maanedligSum: rader.reduce((s, r) => s + (r.sats?.monthlyAmount ?? 0), 0),
    utenSats: rader.filter((r) => !r.sats).length,
  };
}

/**
 * Regner sats for hver seksjon fra det vedtatte budsjettet, gyldig fra 1.1 i budsjettåret.
 * Overstyrte rader for samme dato røres ikke; seksjoner uten brøk får ingen sats og
 * rapporteres.
 */
export async function beregnSatser(db: Db, orgId: string, budgetId: string, av: Aktor) {
  const b = await hentBudsjett(db, orgId, budgetId);
  if (b.status !== "vedtatt") throw new ApiFeil(409, "Satser regnes fra et vedtatt budsjett. Vedta budsjettet først.");
  const validFrom = `${b.year}-01-01`;
  const boliger = await hentBoliger(db, orgId);
  const eksisterende = await db
    .select()
    .from(unitFeeRates)
    .where(and(eq(unitFeeRates.orgId, orgId), eq(unitFeeRates.validFrom, validFrom)));

  let beregnet = 0;
  let overstyrt = 0;
  let utenBrok = 0;
  for (const u of boliger) {
    const brok = { teller: u.brokTeller, nevner: u.brokNevner };
    if (!harBrok(brok)) {
      utenBrok++;
      continue;
    }
    const sats = beregnSats(b.summer.felleskost, brok.teller, brok.nevner);
    const finnes = eksisterende.find((s) => s.unitId === u.id);
    if (finnes?.source === "overstyrt") {
      overstyrt++;
      continue;
    }
    if (finnes) {
      await db
        .update(unitFeeRates)
        .set({ monthlyAmount: sats, budgetId, source: "beregnet" })
        .where(and(eq(unitFeeRates.id, finnes.id), eq(unitFeeRates.orgId, orgId)));
    } else {
      await db.insert(unitFeeRates).values({
        id: randomUUID(), orgId, unitId: u.id, budgetId, monthlyAmount: sats, validFrom, source: "beregnet",
      });
    }
    beregnet++;
  }

  await loggHendelse(db, orgId, av, {
    modul: MODUL, entitet: "budsjett", entitetId: budgetId,
    hendelse: `Beregnet felleskostnadssatser for ${b.year}: ${beregnet} seksjoner${overstyrt ? `, ${overstyrt} overstyrte beholdt` : ""}${utenBrok ? `, ${utenBrok} uten brøk` : ""}`,
  });
  return { beregnet, overstyrt, utenBrok, validFrom };
}

/** Manuell sats (tillegg for garasje, bod …). Erstatter en beregnet rad på samme dato. */
export async function settSats(db: Db, orgId: string, unitId: string, av: Aktor, data: z.infer<typeof satsInn>) {
  const enhet = await krevEnhetIOrg(db, orgId, unitId);
  const finnes = await db
    .select()
    .from(unitFeeRates)
    .where(and(eq(unitFeeRates.orgId, orgId), eq(unitFeeRates.unitId, unitId), eq(unitFeeRates.validFrom, data.validFrom)))
    .limit(1);

  let rad;
  if (finnes[0]) {
    [rad] = await db
      .update(unitFeeRates)
      .set({ monthlyAmount: data.monthlyAmount, note: data.note ?? null, source: "overstyrt" })
      .where(and(eq(unitFeeRates.id, finnes[0].id), eq(unitFeeRates.orgId, orgId)))
      .returning();
  } else {
    [rad] = await db
      .insert(unitFeeRates)
      .values({
        id: randomUUID(), orgId, unitId, monthlyAmount: data.monthlyAmount,
        validFrom: data.validFrom, note: data.note ?? null, source: "overstyrt",
      })
      .returning();
  }
  await loggHendelse(db, orgId, av, {
    modul: MODUL, entitet: "sats", entitetId: rad!.id,
    hendelse: `Satte felleskostnadssats for ${enhetNavn(enhet)} til ${tilKronerTekst(data.monthlyAmount)} kr/mnd fra ${data.validFrom}`,
  });
  return rad!;
}

export async function slettSats(db: Db, orgId: string, rateId: string, av: Aktor) {
  const r = await db
    .select()
    .from(unitFeeRates)
    .where(and(eq(unitFeeRates.id, rateId), eq(unitFeeRates.orgId, orgId)))
    .limit(1);
  if (!r[0]) throw ikkeFunnet("Sats");
  await db.delete(unitFeeRates).where(and(eq(unitFeeRates.id, rateId), eq(unitFeeRates.orgId, orgId)));
  await loggHendelse(db, orgId, av, {
    modul: MODUL, entitet: "sats", entitetId: rateId, hendelse: `Slettet sats gyldig fra ${r[0].validFrom}`,
  });
}

// =======================================================================================
// Halvårskjøringer — fakturagrunnlaget
// =======================================================================================

export const kjoringInn = z.object({
  /** 1.1 eller 1.7 — perioden utledes. */
  periodStart: z.string().date(),
  dueDay: z.number().int().min(1).max(28).default(15),
  note: tekst,
});

export async function hentKjoringer(db: Db, orgId: string) {
  return db
    .select()
    .from(feeRuns)
    .where(eq(feeRuns.orgId, orgId))
    .orderBy(desc(feeRuns.periodStart), desc(feeRuns.createdAt));
}

export async function hentKjoring(db: Db, orgId: string, runId: string) {
  const r = await db
    .select()
    .from(feeRuns)
    .where(and(eq(feeRuns.id, runId), eq(feeRuns.orgId, orgId)))
    .limit(1);
  if (!r[0]) throw ikkeFunnet("Kjøring");

  const linjer = await db
    .select({ linje: feeRunLines, enhet: units })
    .from(feeRunLines)
    .innerJoin(units, eq(units.id, feeRunLines.unitId))
    .where(and(eq(feeRunLines.feeRunId, runId), eq(feeRunLines.orgId, orgId)))
    .orderBy(asc(units.andelsnr), asc(units.oppgang), asc(units.leilighetsnr), asc(feeRunLines.month));

  return {
    ...r[0],
    linjer: linjer.map((l) => ({
      ...l.linje, enhetNavn: enhetKortnavn(l.enhet), oppgang: l.enhet.oppgang, andelsnr: l.enhet.andelsnr,
    })),
  };
}

/**
 * Lager grunnlaget: én linje per seksjon per måned i halvåret, med satsen og eieren som
 * gjelder den måneden. Feiler høyt hvis noen seksjon mangler sats — et grunnlag med hull
 * er verre enn ingen. Seksjoner uten eier får linje uten mottaker og telles.
 *
 * **Eierskifte midt i måneden:** hele måneden faktureres den som eide seksjonen den 1.
 * (avklart 03.09.2026). Kjøper og selger gjør opp seg imellom, som ved overtakelse ellers;
 * DriftIQ deler aldri en måned i dager. Regelen ligger i at `eierPaaDato` slås opp på
 * månedens første dag, ikke på overtakelsesdatoen.
 */
export async function opprettKjoring(db: Db, orgId: string, av: Aktor, data: z.infer<typeof kjoringInn>) {
  const periode = periodeFor(data.periodStart);
  if (!periode) throw ugyldig("En kjøring starter 1. januar eller 1. juli.");

  const overlapp = await db
    .select({ id: feeRuns.id })
    .from(feeRuns)
    .where(and(eq(feeRuns.orgId, orgId), eq(feeRuns.periodStart, periode.start), ne(feeRuns.status, "annullert")))
    .limit(1);
  if (overlapp[0]) {
    throw new ApiFeil(409, `${periode.etikett} er allerede kjørt. Annuller den forrige kjøringen først.`);
  }

  const [boliger, satser, eiere] = await Promise.all([
    hentBoliger(db, orgId),
    db.select().from(unitFeeRates).where(eq(unitFeeRates.orgId, orgId)),
    db.select().from(unitOwners).where(eq(unitOwners.orgId, orgId)),
  ]);
  if (boliger.length === 0) throw ugyldig("Ingen seksjoner er registrert.");

  const maaneder = manederI(periode.start, periode.slutt);
  const utenSats = boliger.filter((u) => !satsPaaDato(satser, u.id, periode.start));
  if (utenSats.length > 0) {
    throw ugyldig(
      `${utenSats.length} ${utenSats.length === 1 ? "seksjon mangler" : "seksjoner mangler"} sats per ${periode.start} — beregn satser fra vedtatt budsjett eller sett sats manuelt først.`,
    );
  }

  const runId = randomUUID();
  const linjer = [];
  const utenEier = new Set<string>();
  for (const u of boliger) {
    for (const m of maaneder) {
      const sats = satsPaaDato(satser, u.id, m)!;
      const eier = eierPaaDato(eiere, u.id, m);
      if (!eier) utenEier.add(u.id);
      linjer.push({
        id: randomUUID(), orgId, feeRunId: runId, unitId: u.id,
        ownerId: eier?.id ?? null, ownerName: eier?.name ?? null,
        month: m, dueDate: forfallsdato(m, data.dueDay), amount: sats.monthlyAmount,
        orderReference: ordreReferanse(u.id, m),
      });
    }
  }

  const total = linjer.reduce((s, l) => s + l.amount, 0);
  await db.insert(feeRuns).values({
    id: runId, orgId, periodStart: periode.start, periodEnd: periode.slutt, dueDay: data.dueDay,
    totalAmount: total, lineCount: linjer.length, missingOwners: utenEier.size,
    createdBy: av.navn, createdByUserId: av.brukerId, note: data.note ?? null,
  });
  await db.insert(feeRunLines).values(linjer);
  await loggHendelse(db, orgId, av, {
    modul: MODUL, entitet: "kjoring", entitetId: runId,
    hendelse: `Laget fakturagrunnlag for ${periode.etikett}: ${linjer.length} linjer, ${tilKronerTekst(total)} kr${utenEier.size ? `, ${utenEier.size} seksjoner uten eier` : ""}`,
  });
  return hentKjoring(db, orgId, runId);
}

export async function annullerKjoring(db: Db, orgId: string, runId: string, av: Aktor) {
  const k = await hentKjoring(db, orgId, runId);
  if (k.status === "sendt") {
    throw new ApiFeil(409, "Kjøringen er sendt til regnskapssystemet og kan ikke annulleres her — krediter i regnskapet.");
  }
  if (k.status === "annullert") return k;
  await db
    .update(feeRuns)
    .set({ status: "annullert" })
    .where(and(eq(feeRuns.id, runId), eq(feeRuns.orgId, orgId)));
  await loggHendelse(db, orgId, av, {
    modul: MODUL, entitet: "kjoring", entitetId: runId,
    hendelse: `Annullerte fakturagrunnlaget for perioden ${k.periodStart}–${k.periodEnd}`,
  });
  return hentKjoring(db, orgId, runId);
}

/** CSV til forretningsfører eller regnskapssystem. Eksport er lesing med revisjonsverdi. */
export async function eksporterKjoring(db: Db, orgId: string, runId: string, av: Aktor) {
  const k = await hentKjoring(db, orgId, runId);
  const eiere = await db.select().from(unitOwners).where(eq(unitOwners.orgId, orgId));
  const rader: Array<Array<string | number | null>> = [
    ["Seksjon", "Oppgang", "Andelsnr", "Eier", "E-post", "Fakturaadresse", "Måned", "Forfall", "Beløp", "Referanse"],
  ];
  for (const l of k.linjer) {
    const eier = l.ownerId ? eiere.find((e) => e.id === l.ownerId) : null;
    rader.push([
      l.enhetNavn, l.oppgang, l.andelsnr, l.ownerName, eier?.email ?? null, eier?.invoiceAddress ?? null,
      l.month.slice(0, 7), l.dueDate, tilKronerTekst(l.amount), l.orderReference,
    ]);
  }
  await loggHendelse(db, orgId, av, {
    modul: MODUL, entitet: "kjoring", entitetId: runId,
    hendelse: `Eksporterte fakturagrunnlaget for perioden ${k.periodStart}–${k.periodEnd} (CSV)`,
  });
  return {
    innhold: new TextEncoder().encode(tilCsv(rader)),
    navn: `felleskostnader-${k.periodStart}-${k.periodEnd}.csv`,
    contentType: "text/csv; charset=utf-8",
  };
}

// =======================================================================================
// Leverandørfakturaer — godkjenning
// =======================================================================================

export const fakturaInn = z.object({
  vendorId: z.string().nullish(),
  supplierName: tekst,
  contractId: z.string().nullish(),
  budgetLineId: z.string().nullish(),
  invoiceNumber: tekst,
  invoiceDate: z.string().date(),
  dueDate: z.string().date().nullish(),
  amount: ore.min(1, "Beløpet må være større enn 0"),
  kid: tekst,
  description: tekst,
  note: tekst,
});

export const fakturaEndring = fakturaInn.partial();

export const beslutningInn = z.object({ note: tekst });
export const avvisningInn = z.object({ note: z.string().trim().min(1, "Skriv hvorfor fakturaen avvises") });
export const betaltInn = z.object({ paidDate: z.string().date() });

async function krevReferanser(db: Db, orgId: string, d: { vendorId?: string | null; contractId?: string | null; budgetLineId?: string | null }) {
  if (d.vendorId) {
    const r = await db.select({ id: vendors.id }).from(vendors).where(and(eq(vendors.id, d.vendorId), eq(vendors.orgId, orgId))).limit(1);
    if (!r[0]) throw ikkeFunnet("Leverandør");
  }
  if (d.contractId) {
    const r = await db.select({ id: contracts.id }).from(contracts).where(and(eq(contracts.id, d.contractId), eq(contracts.orgId, orgId))).limit(1);
    if (!r[0]) throw ikkeFunnet("Avtale");
  }
  if (d.budgetLineId) {
    const r = await db.select({ id: budgetLines.id }).from(budgetLines).where(and(eq(budgetLines.id, d.budgetLineId), eq(budgetLines.orgId, orgId))).limit(1);
    if (!r[0]) throw ikkeFunnet("Budsjettlinje");
  }
}

const fakturaUtvalg = {
  faktura: supplierInvoices,
  vendorName: vendors.name,
  budgetLineName: budgetLines.name,
  budgetYear: budgets.year,
  contractTitle: contracts.title,
};

function medNavn<T extends { faktura: typeof supplierInvoices.$inferSelect; vendorName: string | null; budgetLineName: string | null; budgetYear: number | null; contractTitle: string | null }>(r: T, iDag: string) {
  return {
    ...r.faktura,
    /** Leverandørnavnet slik det skal vises: registeret først, fritekst som reserve. */
    leverandorNavn: r.vendorName ?? r.faktura.supplierName ?? "Ukjent leverandør",
    budsjettlinjeNavn: r.budgetLineName,
    budsjettAar: r.budgetYear,
    kontraktTittel: r.contractTitle,
    forfalt: erForfalt(r.faktura.dueDate, r.faktura.status, iDag),
  };
}

export async function hentFakturaer(db: Db, orgId: string, filter: { status?: string; aar?: number } = {}) {
  const betingelser = [eq(supplierInvoices.orgId, orgId)];
  if (filter.status && (FAKTURA_STATUSER as readonly string[]).includes(filter.status)) {
    betingelser.push(eq(supplierInvoices.status, filter.status));
  }
  if (filter.aar) betingelser.push(sql`extract(year from ${supplierInvoices.invoiceDate}) = ${filter.aar}`);

  const rader = await db
    .select(fakturaUtvalg)
    .from(supplierInvoices)
    .leftJoin(vendors, eq(vendors.id, supplierInvoices.vendorId))
    .leftJoin(budgetLines, eq(budgetLines.id, supplierInvoices.budgetLineId))
    .leftJoin(budgets, eq(budgets.id, budgetLines.budgetId))
    .leftJoin(contracts, eq(contracts.id, supplierInvoices.contractId))
    .where(and(...betingelser))
    .orderBy(desc(supplierInvoices.invoiceDate), desc(supplierInvoices.createdAt));

  const iDag = isoDato(new Date());
  return rader.map((r) => medNavn(r, iDag));
}

export async function hentFaktura(db: Db, orgId: string, invoiceId: string) {
  // Samme joins som lista — detaljen skal aldri vise «—» der lista viser navn.
  const rader = await db
    .select(fakturaUtvalg)
    .from(supplierInvoices)
    .leftJoin(vendors, eq(vendors.id, supplierInvoices.vendorId))
    .leftJoin(budgetLines, eq(budgetLines.id, supplierInvoices.budgetLineId))
    .leftJoin(budgets, eq(budgets.id, budgetLines.budgetId))
    .leftJoin(contracts, eq(contracts.id, supplierInvoices.contractId))
    .where(and(eq(supplierInvoices.id, invoiceId), eq(supplierInvoices.orgId, orgId)))
    .limit(1);
  if (!rader[0]) throw ikkeFunnet("Faktura");
  return medNavn(rader[0], isoDato(new Date()));
}

export async function registrerFaktura(db: Db, orgId: string, av: Aktor, data: z.infer<typeof fakturaInn>) {
  if (!data.vendorId && !data.supplierName) throw ugyldig("Velg leverandør eller skriv leverandørens navn.");
  await krevReferanser(db, orgId, data);
  const [ny] = await db
    .insert(supplierInvoices)
    .values({ id: randomUUID(), orgId, ...data, registeredBy: av.navn, registeredByUserId: av.brukerId })
    .returning();
  return hentFaktura(db, orgId, ny!.id);
}

/** Feltene kan rettes så lenge fakturaen står til godkjenning. Etterpå er de del av beslutningen. */
export async function endreFaktura(db: Db, orgId: string, invoiceId: string, data: z.infer<typeof fakturaEndring>) {
  const f = await hentFaktura(db, orgId, invoiceId);
  if (f.status !== "mottatt") throw new ApiFeil(409, "Fakturaen er behandlet og kan ikke endres. Gjenåpne den først.");
  await krevReferanser(db, orgId, data);
  if (data.vendorId === null && !(data.supplierName ?? f.supplierName)) {
    throw ugyldig("Velg leverandør eller skriv leverandørens navn.");
  }
  await db
    .update(supplierInvoices)
    .set(data)
    .where(and(eq(supplierInvoices.id, invoiceId), eq(supplierInvoices.orgId, orgId)));
  return hentFaktura(db, orgId, invoiceId);
}

async function byttStatus(db: Db, orgId: string, invoiceId: string, til: FakturaStatus, av: Aktor, felter: Partial<typeof supplierInvoices.$inferInsert>, hendelse: string) {
  const f = await hentFaktura(db, orgId, invoiceId);
  if (!FAKTURA_OVERGANGER[f.status as FakturaStatus]?.includes(til)) {
    throw new ApiFeil(409, `Fakturaen er ${f.status} og kan ikke settes til ${til}.`);
  }
  await db
    .update(supplierInvoices)
    .set({ status: til, ...felter })
    .where(and(eq(supplierInvoices.id, invoiceId), eq(supplierInvoices.orgId, orgId)));
  await loggHendelse(db, orgId, av, { modul: MODUL, entitet: "faktura", entitetId: invoiceId, hendelse });
  return hentFaktura(db, orgId, invoiceId);
}

const fakturaTekst = (f: { leverandorNavn: string; invoiceNumber: string | null; amount: number }) =>
  `faktura ${f.invoiceNumber ? `${f.invoiceNumber} ` : ""}fra ${f.leverandorNavn} på ${tilKronerTekst(f.amount)} kr`;

export async function godkjennFaktura(db: Db, orgId: string, invoiceId: string, av: Aktor, data: z.infer<typeof beslutningInn>) {
  const f = await hentFaktura(db, orgId, invoiceId);
  return byttStatus(db, orgId, invoiceId, "godkjent", av,
    { decidedBy: av.navn, decidedByUserId: av.brukerId, decidedAt: new Date(), decisionNote: data.note ?? null },
    `Godkjente ${fakturaTekst(f)}${data.note ? ` — ${data.note}` : ""}`);
}

export async function avvisFaktura(db: Db, orgId: string, invoiceId: string, av: Aktor, data: z.infer<typeof avvisningInn>) {
  const f = await hentFaktura(db, orgId, invoiceId);
  return byttStatus(db, orgId, invoiceId, "avvist", av,
    { decidedBy: av.navn, decidedByUserId: av.brukerId, decidedAt: new Date(), decisionNote: data.note },
    `Avviste ${fakturaTekst(f)} — ${data.note}`);
}

export async function markerBetalt(db: Db, orgId: string, invoiceId: string, av: Aktor, data: z.infer<typeof betaltInn>) {
  const f = await hentFaktura(db, orgId, invoiceId);
  return byttStatus(db, orgId, invoiceId, "betalt", av, { paidDate: data.paidDate },
    `Registrerte ${fakturaTekst(f)} som betalt ${data.paidDate}`);
}

/** Tilbake til «til godkjenning» — fra godkjent (angret) eller avvist (ny runde). */
export async function gjenapneFaktura(db: Db, orgId: string, invoiceId: string, av: Aktor) {
  const f = await hentFaktura(db, orgId, invoiceId);
  return byttStatus(db, orgId, invoiceId, "mottatt", av,
    { decidedBy: null, decidedByUserId: null, decidedAt: null, decisionNote: null },
    `Gjenåpnet ${fakturaTekst(f)} for ny behandling`);
}

/** Sletting er for feilregistreringer — en behandlet faktura er dokumentasjon. */
export async function slettFaktura(db: Db, orgId: string, invoiceId: string, av: Aktor) {
  const f = await hentFaktura(db, orgId, invoiceId);
  if (f.status === "betalt" || f.status === "godkjent") {
    throw new ApiFeil(409, "En godkjent eller betalt faktura kan ikke slettes.");
  }
  await db.delete(supplierInvoices).where(and(eq(supplierInvoices.id, invoiceId), eq(supplierInvoices.orgId, orgId)));
  if (f.fileName) await slettFil(orgId, FILMAPPE, f.fileName);
  await loggHendelse(db, orgId, av, {
    modul: MODUL, entitet: "faktura", entitetId: invoiceId, hendelse: `Slettet ${fakturaTekst(f)}`,
  });
}

/** Vedlegget — samme mekanikk som avtaledokumentet i kontrakter, differansen mot kvoten. */
export async function lastOppFakturafil(db: Db, orgId: string, invoiceId: string, fil: File) {
  const f = await hentFaktura(db, orgId, invoiceId);
  const opplasting = await lagreFil(db, orgId, FILMAPPE, fil, {
    typer: FAKTURA_TYPER,
    maksStorrelse: FAKTURA_MAKS,
    erstatter: f.fileSize,
  });
  await db
    .update(supplierInvoices)
    .set({ fileName: opplasting.filnavn, fileOriginalName: opplasting.originalnavn, fileSize: opplasting.storrelse })
    .where(and(eq(supplierInvoices.id, invoiceId), eq(supplierInvoices.orgId, orgId)));
  if (f.fileName) await slettFil(orgId, FILMAPPE, f.fileName);
  return hentFaktura(db, orgId, invoiceId);
}

export async function slettFakturafil(db: Db, orgId: string, invoiceId: string) {
  const f = await hentFaktura(db, orgId, invoiceId);
  if (!f.fileName) throw ikkeFunnet("Fil");
  await db
    .update(supplierInvoices)
    .set({ fileName: null, fileOriginalName: null, fileSize: null })
    .where(and(eq(supplierInvoices.id, invoiceId), eq(supplierInvoices.orgId, orgId)));
  await slettFil(orgId, FILMAPPE, f.fileName);
  return hentFaktura(db, orgId, invoiceId);
}

export const FAKTURA_FILMAPPE = FILMAPPE;

// =======================================================================================
// Oversikten
// =======================================================================================

/** Alt oversiktsfanen trenger, i ett kall. `naa` er argument for testbarhet. */
export async function hentOkonomioversikt(db: Db, orgId: string, naa = new Date()) {
  const aar = naa.getFullYear();
  const iDag = isoDato(naa);

  const [budsjetter, eiere, satser, fakturaer, kjoringer] = await Promise.all([
    hentBudsjetter(db, orgId),
    hentEiere(db, orgId),
    hentSatser(db, orgId, iDag),
    hentFakturaer(db, orgId),
    hentKjoringer(db, orgId),
  ]);

  const aarets = budsjetter.find((b) => b.year === aar) ?? null;
  const budsjett = aarets ? await hentBudsjett(db, orgId, aarets.id) : null;

  const sumAv = (liste: typeof fakturaer) => ({
    antall: liste.length,
    sum: liste.reduce((s, f) => s + f.amount, 0),
  });

  return {
    aar,
    budsjett: budsjett
      ? {
          id: budsjett.id, year: budsjett.year, status: budsjett.status, adoptedDate: budsjett.adoptedDate,
          summer: budsjett.summer, faktiskKostnader: budsjett.faktiskKostnader,
          linjer: budsjett.linjer
            .filter((l) => l.kind === "kostnad")
            .map((l) => ({ id: l.id, name: l.name, amount: l.amount, faktisk: l.faktisk })),
        }
      : null,
    nesteBudsjett: budsjetter.find((b) => b.year === aar + 1) ?? null,
    fakturaer: {
      tilGodkjenning: sumAv(fakturaer.filter((f) => f.status === "mottatt")),
      forfalte: sumAv(fakturaer.filter((f) => f.forfalt)),
      godkjentIkkeBetalt: sumAv(fakturaer.filter((f) => f.status === "godkjent")),
      betaltIAar: sumAv(fakturaer.filter((f) => f.status === "betalt" && f.invoiceDate.startsWith(String(aar)))),
      nyeste: fakturaer.filter((f) => f.status === "mottatt").slice(0, 5),
    },
    eiere: {
      seksjoner: eiere.seksjoner.length,
      utenEier: eiere.utenEier,
      utenBrok: eiere.utenBrok,
      brokSum: eiere.brokSum,
    },
    satser: { maanedligSum: satser.maanedligSum, utenSats: satser.utenSats, aarligSum: satser.maanedligSum * 12 },
    sisteKjoring: kjoringer.find((k) => k.status !== "annullert") ?? null,
  };
}
