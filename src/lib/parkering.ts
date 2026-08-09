/**
 * Parkering — validering og forretningsregler. Port av v1s `routers/parking.py` og de
 * tilhørende Pydantic-skjemaene.
 *
 * Zod erstatter Pydantic. Feilmeldingene er norske fordi de vises til brukeren; `lesKropp()`
 * i api.ts plukker den første og legger den i `detail`, samme form som v1s HTTPException.
 */

import { and, asc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "../db/client";
import { parkingLeases, parkingSpots, parkingWaitlist } from "../db/schema/parking";
import { ikkeFunnet, ugyldig } from "./api";

export const EIERSKAP = ["felles", "privat"] as const;
export const PLASSTYPER = ["standard", "lading", "gjest"] as const;
export const STATUSER = ["disponert", "ledig", "utleid"] as const;

export const plassInn = z.object({
  number: z.string().trim().min(1, "Plassnummer må fylles ut"),
  areaLabel: z.string().trim().nullish(),
  ownershipType: z.enum(EIERSKAP).default("felles"),
  spotType: z.enum(PLASSTYPER).default("standard"),
  status: z.enum(STATUSER).default("ledig"),
  holderName: z.string().trim().nullish(),
  unitLabel: z.string().trim().nullish(),
  notes: z.string().nullish(),
});

export const plassEndring = plassInn.partial();

export const avtaleInn = z.object({
  spotId: z.string().min(1, "Plass må velges"),
  tenantName: z.string().trim().min(1, "Leietaker må fylles ut"),
  pricePerMonth: z.number().int().min(0, "Pris kan ikke være negativ"),
  startDate: z.string().date().nullish(),
  endDate: z.string().date().nullish(),
  noticePeriodMonths: z.number().int().min(0).nullish(),
});

export const ventelisteInn = z.object({
  name: z.string().trim().min(1, "Navn må fylles ut"),
  requestedType: z.enum(PLASSTYPER).default("standard"),
  /** Utelatt = i dag, som i v1. */
  requestedAt: z.string().date().optional(),
  notes: z.string().nullish(),
});

const iDag = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------------------
// Plasser
// ---------------------------------------------------------------------------------------

/** Plassene med sin eventuelle aktive avtale, sortert på nummer — som i v1. */
export async function hentPlasser(db: Db, orgId: string) {
  const rader = await db
    .select()
    .from(parkingSpots)
    .leftJoin(parkingLeases, eq(parkingLeases.spotId, parkingSpots.id))
    // Filteret står selv om RLS også ville stoppet andre org-er. To uavhengige lag som må
    // svikte samtidig er hele poenget — se rls/tables.ts.
    .where(eq(parkingSpots.orgId, orgId))
    .orderBy(asc(parkingSpots.number));

  return rader.map((r) => ({ ...r.parking_spots, lease: r.parking_leases }));
}

async function nummerErTatt(db: Db, orgId: string, nummer: string): Promise<boolean> {
  const rader = await db
    .select({ id: parkingSpots.id })
    .from(parkingSpots)
    .where(and(eq(parkingSpots.orgId, orgId), eq(parkingSpots.number, nummer)))
    .limit(1);
  return rader.length > 0;
}

export async function hentPlass(db: Db, orgId: string, spotId: string) {
  const rader = await db
    .select()
    .from(parkingSpots)
    .where(and(eq(parkingSpots.id, spotId), eq(parkingSpots.orgId, orgId)))
    .limit(1);
  const plass = rader[0];
  if (!plass) throw ikkeFunnet("Parkeringsplass");
  return plass;
}

export async function opprettPlass(db: Db, orgId: string, data: z.infer<typeof plassInn>) {
  if (await nummerErTatt(db, orgId, data.number)) {
    throw ugyldig(`Plass ${data.number} finnes allerede`);
  }
  const [ny] = await db
    .insert(parkingSpots)
    .values({ id: randomUUID(), orgId, ...data })
    .returning();
  return { ...ny!, lease: null };
}

export async function endrePlass(
  db: Db,
  orgId: string,
  spotId: string,
  data: z.infer<typeof plassEndring>,
) {
  const plass = await hentPlass(db, orgId, spotId);
  if (data.number && data.number !== plass.number && (await nummerErTatt(db, orgId, data.number))) {
    throw ugyldig(`Plass ${data.number} finnes allerede`);
  }
  const [endret] = await db
    .update(parkingSpots)
    .set(data)
    .where(and(eq(parkingSpots.id, spotId), eq(parkingSpots.orgId, orgId)))
    .returning();
  return endret!;
}

export async function slettPlass(db: Db, orgId: string, spotId: string) {
  await hentPlass(db, orgId, spotId); // 404 i stedet for stille no-op
  await db
    .delete(parkingSpots)
    .where(and(eq(parkingSpots.id, spotId), eq(parkingSpots.orgId, orgId)));
}

// ---------------------------------------------------------------------------------------
// Leieavtaler
// ---------------------------------------------------------------------------------------

export async function hentAvtaler(db: Db, orgId: string) {
  return db
    .select()
    .from(parkingLeases)
    .where(eq(parkingLeases.orgId, orgId))
    .orderBy(asc(parkingLeases.createdAt));
}

/**
 * Oppretter en avtale og setter plassen til «utleid».
 *
 * Statusen og avtalen skrives i SAMME transaksjon — `withOrg` holder én transaksjon for hele
 * forespørselen. I v1 var dette to `db.add`/`setattr` fulgt av én commit, altså også atomisk,
 * men avhengig av at ingen la inn en commit imellom.
 */
export async function opprettAvtale(db: Db, orgId: string, data: z.infer<typeof avtaleInn>) {
  const plass = await hentPlass(db, orgId, data.spotId);

  const finnes = await db
    .select({ id: parkingLeases.id })
    .from(parkingLeases)
    .where(and(eq(parkingLeases.spotId, data.spotId), eq(parkingLeases.orgId, orgId)))
    .limit(1);
  if (finnes.length > 0) {
    throw ugyldig(`Plass ${plass.number} har allerede en aktiv leieavtale`);
  }

  const [ny] = await db
    .insert(parkingLeases)
    .values({ id: randomUUID(), orgId, ...data })
    .returning();

  await db
    .update(parkingSpots)
    .set({ status: "utleid" })
    .where(and(eq(parkingSpots.id, data.spotId), eq(parkingSpots.orgId, orgId)));

  return ny!;
}

/**
 * Avslutter et leieforhold. Plassen settes tilbake til «ledig» — men bare hvis den faktisk
 * sto som «utleid». Sto den som «disponert», har styret tatt den til eget bruk, og den skal
 * ikke stille bli utleiebar igjen.
 */
export async function avsluttAvtale(db: Db, orgId: string, leaseId: string) {
  const rader = await db
    .select()
    .from(parkingLeases)
    .where(and(eq(parkingLeases.id, leaseId), eq(parkingLeases.orgId, orgId)))
    .limit(1);
  const avtale = rader[0];
  if (!avtale) throw ikkeFunnet("Leieavtale");

  await db
    .update(parkingSpots)
    .set({ status: "ledig" })
    .where(
      and(
        eq(parkingSpots.id, avtale.spotId),
        eq(parkingSpots.orgId, orgId),
        eq(parkingSpots.status, "utleid"),
      ),
    );

  await db.delete(parkingLeases).where(and(eq(parkingLeases.id, leaseId), eq(parkingLeases.orgId, orgId)));
}

// ---------------------------------------------------------------------------------------
// Venteliste
// ---------------------------------------------------------------------------------------

export async function hentVenteliste(db: Db, orgId: string) {
  return db
    .select()
    .from(parkingWaitlist)
    .where(eq(parkingWaitlist.orgId, orgId))
    .orderBy(asc(parkingWaitlist.requestedAt));
}

export async function leggPaVenteliste(db: Db, orgId: string, data: z.infer<typeof ventelisteInn>) {
  const [ny] = await db
    .insert(parkingWaitlist)
    .values({ id: randomUUID(), orgId, ...data, requestedAt: data.requestedAt ?? iDag() })
    .returning();
  return ny!;
}

export async function slettFraVenteliste(db: Db, orgId: string, entryId: string) {
  const rader = await db
    .select({ id: parkingWaitlist.id })
    .from(parkingWaitlist)
    .where(and(eq(parkingWaitlist.id, entryId), eq(parkingWaitlist.orgId, orgId)))
    .limit(1);
  if (rader.length === 0) throw ikkeFunnet("Venteliste-oppføring");

  await db
    .delete(parkingWaitlist)
    .where(and(eq(parkingWaitlist.id, entryId), eq(parkingWaitlist.orgId, orgId)));
}
