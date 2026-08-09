/**
 * Driftslogg — de manuelle loggføringene. Port av v1s `routers/driftslogg.py`.
 *
 * Resten av loggen slås sammen klient-side fra oppgaver, avvik, vedlikehold og vernerunde.
 */

import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "../db/client";
import { logEntries } from "../db/schema/driftslogg";
import { vendors } from "../db/schema/vendors";
import { ikkeFunnet } from "./api";

export const loggInn = z.object({
  title: z.string().trim().min(1, "Tittel må fylles ut"),
  description: z.string().nullish(),
  entryDate: z.string().date(),
  vendorId: z.string().nullish(),
});

export async function hentLogg(db: Db, orgId: string) {
  return db
    .select({
      logg: logEntries,
      vendorName: vendors.name,
    })
    .from(logEntries)
    .leftJoin(vendors, eq(vendors.id, logEntries.vendorId))
    .where(eq(logEntries.orgId, orgId))
    .orderBy(desc(logEntries.entryDate), desc(logEntries.createdAt))
    .then((rader) => rader.map((r) => ({ ...r.logg, vendorName: r.vendorName })));
}

export async function opprettLogg(
  db: Db,
  orgId: string,
  forfatter: string,
  data: z.infer<typeof loggInn>,
) {
  // Fremmednøkkelen må peke inn i SAMME org. RLS ville også stoppet en leverandør fra en
  // annen kunde, men da med en fremmednøkkelfeil i stedet for en forståelig 404 — og
  // valideringen er dokumentert som et krav for hvert org-endepunkt.
  if (data.vendorId) {
    const rader = await db
      .select({ id: vendors.id })
      .from(vendors)
      .where(and(eq(vendors.id, data.vendorId), eq(vendors.orgId, orgId)))
      .limit(1);
    if (rader.length === 0) throw ikkeFunnet("Leverandør");
  }

  const [ny] = await db
    .insert(logEntries)
    .values({ id: randomUUID(), orgId, createdBy: forfatter, ...data })
    .returning();
  return ny!;
}

export async function slettLogg(db: Db, orgId: string, entryId: string) {
  const rader = await db
    .select({ id: logEntries.id })
    .from(logEntries)
    .where(and(eq(logEntries.id, entryId), eq(logEntries.orgId, orgId)))
    .limit(1);
  if (rader.length === 0) throw ikkeFunnet("Loggføring");

  await db.delete(logEntries).where(and(eq(logEntries.id, entryId), eq(logEntries.orgId, orgId)));
}
