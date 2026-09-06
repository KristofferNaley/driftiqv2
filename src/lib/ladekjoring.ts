/**
 * Ladekjøringer — fakturagrunnlaget for strøm til lading (docs/easee.md «Etappe 3»),
 * etter mønster av halvårskjøringen i `okonomi.ts`.
 *
 * Perioden er sameiets valg: én måned, et kvartal, et halvår eller et år, alltid hele
 * måneder. Linjene er summen av `hentRapport()` for hver måned i perioden, per seksjon —
 * det er rapporten som prises, kjøringen bare samler. Linjer uten mottaker (plass uten
 * seksjon, seksjon uten eier, lader uten plass) blir stående i kjøringen med `issue`
 * satt og faktureres ikke; styret ser dem og kan lage ny kjøring når det er ordnet
 * (den forrige må annulleres først — én kjøring per periode).
 *
 * Mottakeren er seksjonens eier når kjøringen lages (eierskifte i perioden: den nye
 * eieren får hele perioden, som ved felleskostnader — kjøper og selger gjør opp seg
 * imellom). Sendingen går gjennom `regnskapskobling.ts`, aldri direkte til et system.
 */

import { and, asc, desc, eq, ne } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "../db/client";
import { chargingRunLines, chargingRuns } from "../db/schema/ladekjoring";
import type { Aktor } from "./aktor";
import { ApiFeil, ikkeFunnet, ugyldig } from "./api";
import { hentRapport } from "./easeekobling";
import { loggHendelse } from "./hendelser";
import { tilCsv, tilKronerTekst } from "./okonomiregler";
import { LADING_INNTEKTSKONTO_STANDARD, regnskapNavn } from "./regnskap";
import { adapterFor, hentRegnskap, type Fakturaoppdrag } from "./regnskapskobling";

const MODUL = "parkering" as const;

export const PERIODELENGDER = [1, 3, 6, 12] as const;
export const PERIODELENGDE_ETIKETT: Record<(typeof PERIODELENGDER)[number], string> = { 1: "Måned", 3: "Kvartal", 6: "Halvår", 12: "År" };

export const ladekjoringInn = z.object({
  /** Første dag i første måned. */
  periodStart: z.string().date(),
  maaneder: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]),
  dueDate: z.string().date(),
  incomeAccount: z.string().trim().regex(/^\d{4}$/, "Inntektskonto er fire siffer").default(LADING_INNTEKTSKONTO_STANDARD),
  note: z.string().trim().max(500).nullish(),
});

const isoDato = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

/** Periodens siste dag og månedene i den, fra første dag og antall måneder. */
export function periodeFra(periodStart: string, maaneder: number): { start: string; slutt: string; maanedene: Array<{ aar: number; maaned: number }> } {
  const [y, m, d] = periodStart.split("-").map(Number) as [number, number, number];
  if (d !== 1) throw ugyldig("Perioden må starte den 1. i en måned.");
  const maanedene: Array<{ aar: number; maaned: number }> = [];
  for (let i = 0; i < maaneder; i++) {
    const dt = new Date(Date.UTC(y, m - 1 + i, 1));
    maanedene.push({ aar: dt.getUTCFullYear(), maaned: dt.getUTCMonth() + 1 });
  }
  const slutt = new Date(Date.UTC(y, m - 1 + maaneder, 0));
  return { start: periodStart, slutt: isoDato(slutt), maanedene };
}

export function periodeEtikett(start: string, slutt: string): string {
  const [ys, ms] = start.split("-").map(Number) as [number, number];
  const [ye, me] = slutt.split("-").map(Number) as [number, number];
  const navn = (y: number, m: number) => new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("nb-NO", { month: "long", year: "numeric", timeZone: "UTC" });
  if (ys === ye && ms === me) return navn(ys, ms);
  return `${navn(ys, ms)} – ${navn(ye, me)}`;
}

/**
 * «Ordrereferanse» på fakturaen mottakeren ser — derfor lesbar: «Lading juli 2026».
 * Idempotensnøkkelen mot regnskapssystemet er referansen SAMMEN MED kunden (seksjonen):
 * adapteret slår opp på begge, så samme tekst hos to eiere er to fakturaer, og samme
 * eier og periode alltid én. Første utkast hadde seksjonens id i teksten (60 tegn,
 * 06.09.2026) — unødvendig når kunden bærer identiteten.
 */
export const ordreReferanse = (start: string, slutt: string) => `Lading ${periodeEtikett(start, slutt)}`;

export async function hentLadekjoringer(db: Db, orgId: string) {
  return db
    .select()
    .from(chargingRuns)
    .where(eq(chargingRuns.orgId, orgId))
    .orderBy(desc(chargingRuns.periodStart), desc(chargingRuns.createdAt));
}

export async function hentLadekjoring(db: Db, orgId: string, runId: string) {
  const r = await db.select().from(chargingRuns).where(and(eq(chargingRuns.id, runId), eq(chargingRuns.orgId, orgId))).limit(1);
  if (!r[0]) throw ikkeFunnet("Ladekjøring");
  const linjer = await db
    .select()
    .from(chargingRunLines)
    .where(and(eq(chargingRunLines.chargingRunId, runId), eq(chargingRunLines.orgId, orgId)))
    .orderBy(asc(chargingRunLines.unitLabel), asc(chargingRunLines.description));
  return { ...r[0], etikett: periodeEtikett(r[0].periodStart, r[0].periodEnd), linjer };
}

/**
 * Lager grunnlaget. Feiler høyt hvis en måned i perioden mangler prisplan eller
 * spotpriser — et grunnlag med hull er verre enn ingen. Overlapp med en annen kjøring
 * som ikke er annullert avvises: samme måned skal aldri faktureres to ganger.
 */
export async function opprettLadekjoring(db: Db, orgId: string, av: Aktor, data: z.infer<typeof ladekjoringInn>) {
  const periode = periodeFra(data.periodStart, data.maaneder);
  if (data.dueDate < periode.start) throw ugyldig("Forfall kan ikke være før perioden begynner.");

  const andre = await db
    .select({ periodStart: chargingRuns.periodStart, periodEnd: chargingRuns.periodEnd })
    .from(chargingRuns)
    .where(and(eq(chargingRuns.orgId, orgId), ne(chargingRuns.status, "annullert")));
  const overlapp = andre.find((k) => k.periodStart <= periode.slutt && k.periodEnd >= periode.start);
  if (overlapp) {
    throw new ApiFeil(409, `${periodeEtikett(overlapp.periodStart, overlapp.periodEnd)} er allerede kjørt. Annuller den forrige kjøringen først.`);
  }

  type Sum = { unitId: string | null; ownerId: string | null; ownerName: string | null; ownerEmail: string | null; unitLabel: string | null; plasser: Set<string>; issue: string | null; kwh: number; kwhDay: number; kwhNight: number; energy: number; grid: number; fixed: number };
  const perMottaker = new Map<string, Sum>();
  const problemer: string[] = [];
  for (const m of periode.maanedene) {
    const r = await hentRapport(db, orgId, m.aar, m.maaned);
    const navn = periodeEtikett(`${m.aar}-${String(m.maaned).padStart(2, "0")}-01`, `${m.aar}-${String(m.maaned).padStart(2, "0")}-01`);
    if (!r.plan) { problemer.push(`${navn}: ingen prisplan`); continue; }
    const utenPris = r.linjer.reduce((n, l) => n + l.timerUtenPris, 0);
    if (utenPris > 0) problemer.push(`${navn}: ${utenPris} timer mangler spotpris`);
    for (const l of r.linjer) {
      if (l.kwh === 0 && l.fastleddOre === 0) continue;
      const nokkel = l.status === "klar" ? `seksjon:${l.seksjon!.id}` : `lader:${l.laderId}`;
      const s = perMottaker.get(nokkel) ?? {
        unitId: l.status === "klar" ? l.seksjon!.id : null,
        ownerId: l.eier?.id ?? null,
        ownerName: l.eier?.name ?? null,
        ownerEmail: l.eier?.email ?? null,
        unitLabel: l.seksjon?.navn ?? l.plass?.unitLabel ?? null,
        plasser: new Set<string>(),
        issue: l.status === "klar" ? null : l.status === "mangler_plass" ? "Laderen er ikke koblet til plass" : l.status === "mangler_seksjon" ? "Plassen mangler seksjon" : "Seksjonen har ingen eier",
        kwh: 0, kwhDay: 0, kwhNight: 0, energy: 0, grid: 0, fixed: 0,
      };
      s.plasser.add(l.plass ? `${l.plass.number}` : l.laderNavn);
      s.kwh += l.kwh; s.kwhDay += l.kwhDag; s.kwhNight += l.kwhNatt;
      s.energy += l.kraftOre; s.grid += l.nettOre; s.fixed += l.fastleddOre;
      perMottaker.set(nokkel, s);
    }
  }
  if (problemer.length > 0) throw ugyldig(`Grunnlaget kan ikke lages: ${problemer.join("; ")}. Sett priser og kjør «Oppdater fra Easee» først.`);
  if (perMottaker.size === 0) throw ugyldig("Ingen lading å fakturere i perioden.");

  const runId = randomUUID();
  const linjer = [...perMottaker.values()].map((s) => ({
    id: randomUUID(), orgId, chargingRunId: runId,
    unitId: s.unitId, ownerId: s.ownerId, ownerName: s.ownerName, ownerEmail: s.ownerEmail, unitLabel: s.unitLabel,
    description: `Lading ${periodeEtikett(periode.start, periode.slutt)} · plass ${[...s.plasser].sort((a, b) => a.localeCompare(b, "nb", { numeric: true })).join(", ")}`,
    issue: s.issue,
    kwh: s.kwh, kwhDay: s.kwhDay, kwhNight: s.kwhNight,
    energyAmount: s.energy, gridAmount: s.grid, fixedAmount: s.fixed,
    amount: s.energy + s.grid + s.fixed,
    orderReference: s.unitId ? ordreReferanse(periode.start, periode.slutt) : `Lading ${periodeEtikett(periode.start, periode.slutt)} (uten mottaker ${randomUUID().slice(0, 8)})`,
  }));
  const medMottaker = linjer.filter((l) => l.unitId && l.ownerId);
  const total = medMottaker.reduce((n, l) => n + l.amount, 0);
  await db.insert(chargingRuns).values({
    id: runId, orgId, periodStart: periode.start, periodEnd: periode.slutt, dueDate: data.dueDate, incomeAccount: data.incomeAccount,
    totalAmount: total, lineCount: linjer.length, missingRecipients: linjer.length - medMottaker.length,
    totalKwh: linjer.reduce((n, l) => n + l.kwh, 0),
    createdBy: av.navn, createdByUserId: av.brukerId, note: data.note ?? null,
  });
  await db.insert(chargingRunLines).values(linjer);
  await loggHendelse(db, orgId, av, {
    modul: MODUL, entitet: "ladekjoring", entitetId: runId,
    hendelse: `Laget fakturagrunnlag for lading ${periodeEtikett(periode.start, periode.slutt)}: ${medMottaker.length} linjer, ${tilKronerTekst(total)} kr${linjer.length - medMottaker.length ? `, ${linjer.length - medMottaker.length} uten mottaker` : ""}`,
  });
  return hentLadekjoring(db, orgId, runId);
}

export const ladekjoringEndring = z.object({
  dueDate: z.string().date().optional(),
  incomeAccount: z.string().trim().regex(/^\d{4}$/, "Inntektskonto er fire siffer").optional(),
});

/** Forfall og konto kan rettes på et grunnlag uten å lage det på nytt — de rører ikke linjene. */
export async function endreLadekjoring(db: Db, orgId: string, runId: string, av: Aktor, data: z.infer<typeof ladekjoringEndring>) {
  const k = await hentLadekjoring(db, orgId, runId);
  if (k.status !== "grunnlag") throw ugyldig("Bare et grunnlag som ikke er sendt kan endres.");
  await db.update(chargingRuns).set({ ...(data.dueDate ? { dueDate: data.dueDate } : {}), ...(data.incomeAccount ? { incomeAccount: data.incomeAccount } : {}) }).where(and(eq(chargingRuns.id, runId), eq(chargingRuns.orgId, orgId)));
  await loggHendelse(db, orgId, av, {
    modul: MODUL, entitet: "ladekjoring", entitetId: runId,
    hendelse: `Endret ladekjøringen ${k.etikett}: ${[data.dueDate ? `forfall ${data.dueDate}` : null, data.incomeAccount ? `konto ${data.incomeAccount}` : null].filter(Boolean).join(", ")}`,
  });
  return hentLadekjoring(db, orgId, runId);
}

export async function annullerLadekjoring(db: Db, orgId: string, runId: string, av: Aktor) {
  const k = await hentLadekjoring(db, orgId, runId);
  if (k.status === "annullert") throw ugyldig("Kjøringen er allerede annullert.");
  if (k.status === "sendt") throw ugyldig(`Kjøringen er sendt til ${regnskapNavn(k.sentTo as never)} — fakturaene må krediteres der.`);
  await db.update(chargingRuns).set({ status: "annullert" }).where(and(eq(chargingRuns.id, runId), eq(chargingRuns.orgId, orgId)));
  await loggHendelse(db, orgId, av, {
    modul: MODUL, entitet: "ladekjoring", entitetId: runId,
    hendelse: `Annullerte fakturagrunnlaget for lading ${k.etikett}`,
  });
  return hentLadekjoring(db, orgId, runId);
}

/** CSV til forretningsfører eller regneark. Eksport er lesing med revisjonsverdi. */
export async function eksporterLadekjoring(db: Db, orgId: string, runId: string, av: Aktor) {
  const k = await hentLadekjoring(db, orgId, runId);
  const rader: Array<Array<string | number | null>> = [
    ["Seksjon", "Eier", "E-post", "Beskrivelse", "kWh", "kWh dag", "kWh natt", "Kraft", "Nettleie", "Fastledd", "Beløp", "Forfall", "Referanse", "Fakturanr", "Merknad"],
  ];
  for (const l of k.linjer) {
    rader.push([
      l.unitLabel, l.ownerName, l.ownerEmail, l.description,
      l.kwh.toFixed(2).replace(".", ","), l.kwhDay.toFixed(2).replace(".", ","), l.kwhNight.toFixed(2).replace(".", ","),
      tilKronerTekst(l.energyAmount), tilKronerTekst(l.gridAmount), tilKronerTekst(l.fixedAmount), tilKronerTekst(l.amount),
      k.dueDate, l.orderReference, l.externalNumber, l.issue,
    ]);
  }
  await loggHendelse(db, orgId, av, {
    modul: MODUL, entitet: "ladekjoring", entitetId: runId,
    hendelse: `Eksporterte fakturagrunnlaget for lading ${k.etikett} (CSV)`,
  });
  return {
    innhold: new TextEncoder().encode(tilCsv(rader)),
    navn: `lading-${k.periodStart}-${k.periodEnd}.csv`,
    contentType: "text/csv; charset=utf-8",
  };
}

/**
 * Sender kjøringen til regnskapssystemet orgen er koblet til. Linjer uten mottaker
 * hoppes over. Adapteret er idempotent på `orderReference`, så et nytt forsøk etter feil
 * lager ikke dobbeltfakturaer. Alt utadrettet skjer i handleren — ikke i `etterCommit` —
 * fordi referansene skal lagres i samme transaksjon som statusen.
 */
export async function sendLadekjoring(db: Db, orgId: string, runId: string, av: Aktor, naa = new Date()) {
  const k = await hentLadekjoring(db, orgId, runId);
  if (k.status === "annullert") throw ugyldig("Kjøringen er annullert.");
  // En sendt kjøring kan sendes igjen bare for å få ut e-poster som mangler — adapteret
  // gjenbruker fakturaene på referansen, så ingenting opprettes to ganger.
  if (k.status === "sendt" && !k.linjer.some((l) => l.externalRef && l.ownerEmail && !l.sentToRecipient)) throw ugyldig("Kjøringen er allerede sendt, og alle fakturaer er levert.");
  const adapter = await adapterFor(db, orgId);
  const regnskap = await hentRegnskap(db, orgId);
  const oppdrag: Fakturaoppdrag[] = k.linjer
    .filter((l) => l.unitId && l.ownerId && l.amount > 0)
    .map((l) => ({
      linjeId: l.id,
      mottakerNokkel: l.unitId!,
      mottakerNavn: l.ownerName ?? l.unitLabel ?? "Seksjonseier",
      mottakerEpost: l.ownerEmail,
      orderReference: l.orderReference,
      beskrivelse: `${l.description} · ${l.kwh.toFixed(1).replace(".", ",")} kWh`,
      belopOre: l.amount,
      issueDate: naa.toISOString().slice(0, 10),
      dueDate: k.dueDate,
      incomeAccount: k.incomeAccount,
    }));
  if (oppdrag.length === 0) throw ugyldig("Ingen linjer med mottaker å fakturere.");

  const svar = await adapter.sendFakturaer(db, orgId, oppdrag, { tittel: `Strøm til lading ${k.etikett}` });
  for (const s of svar) {
    await db
      .update(chargingRunLines)
      .set({ externalRef: s.externalRef, externalNumber: s.externalNumber, ...(s.sendt ? { sentToRecipient: naa } : {}) })
      .where(and(eq(chargingRunLines.id, s.linjeId), eq(chargingRunLines.orgId, orgId)));
  }
  const nye = svar.filter((s) => !k.linjer.find((l) => l.id === s.linjeId)?.externalRef).length;
  await db
    .update(chargingRuns)
    .set({ status: "sendt", sentTo: adapter.system, sentAt: naa })
    .where(and(eq(chargingRuns.id, runId), eq(chargingRuns.orgId, orgId)));
  await loggHendelse(db, orgId, av, {
    modul: MODUL, entitet: "ladekjoring", entitetId: runId,
    hendelse: k.status === "sendt"
      ? `Sendte ${svar.filter((s) => s.sendt).length} ladefaktura${svar.filter((s) => s.sendt).length === 1 ? "" : "er"} for ${k.etikett} på nytt på e-post via ${regnskap.navn}`
      : `Sendte ${nye} ladefaktura${nye === 1 ? "" : "er"} for ${k.etikett} til ${regnskap.navn}${regnskap.foretak ? ` (${regnskap.foretak})` : ""}, ${tilKronerTekst(oppdrag.reduce((n, o) => n + o.belopOre, 0))} kr — ${svar.filter((s) => s.sendt).length} sendt på e-post`,
  });
  return hentLadekjoring(db, orgId, runId);
}
