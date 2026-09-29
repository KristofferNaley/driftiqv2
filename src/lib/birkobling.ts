/**
 * BIR-koblingen: hvilken BIR-oppføring borettslaget er, og tømmedagene hentet derfra.
 * HTTP og tolkning ligger i `bir.ts`. Designnotatet er `docs/bir.md`.
 *
 * ## Skjermen spør aldri BIR
 *
 * Datoene hentes ved kobling, med «Hent nå» og av den ukentlige jobben «bir-synk», og lagres
 * i `bir_pickups`. Skjermen leser tabellen. Da står tavla også når bir.no er nede eller har
 * endret nettsiden: de sist kjente datoene vises til de er passert.
 *
 * ## Feil noteres, de kastes ikke
 *
 * En mislykket henting lagrer `last_error` og RETURNERER — den kaster ikke. Kastet den, ville
 * transaksjonen rulle tilbake og ta feilnoteringen med seg (samme felle som `last_error` hos
 * Easee, se CLAUDE.md «Fallgruver»). Gamle datoer blir stående.
 */

import { randomUUID } from "node:crypto";
import { and, asc, eq, gte } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import { birPickups, birSettings } from "../db/schema/bir";
import { ApiFeil, ugyldig } from "./api";
import type { Aktor } from "./aktor";
import { avfallEtikett } from "./avfallsregler";
import { BirFeil, hentKalender, sokBir, type BirTreff } from "./bir";
import { loggHendelse } from "./hendelser";
import { osloIDag } from "./oppslagstavleregler";

/** Søket mot BIR. Nettfeil blir 503 — aldri 502/504, som Cloudflare bytter ut (CLAUDE.md). */
export async function sokIBir(q: string): Promise<BirTreff[]> {
  if (q.trim().length < 3) throw ugyldig("Skriv minst tre tegn");
  try {
    return await sokBir(q.trim());
  } catch (e) {
    if (e instanceof BirFeil) throw new ApiFeil(503, e.message);
    throw e;
  }
}

export const birValg = z.object({
  id: z.string().regex(/^[0-9a-f-]{36}$/i, "Ugyldig BIR-id"),
  navn: z.string().trim().min(1).max(120),
  eiendom: z.string().trim().max(40).nullish(),
});

export async function hentBirStatus(db: Db, orgId: string) {
  const [k] = await db.select().from(birSettings).where(eq(birSettings.orgId, orgId)).limit(1);
  if (!k) return null;
  const datoer = await db
    .select({ fraksjon: birPickups.fraction, dato: birPickups.pickupDate })
    .from(birPickups)
    .where(and(eq(birPickups.orgId, orgId), gte(birPickups.pickupDate, osloIDag())))
    .orderBy(asc(birPickups.pickupDate), asc(birPickups.fraction));
  return {
    birId: k.birId,
    navn: k.birName,
    eiendom: k.realEstateId,
    koblet: k.createdAt.toISOString(),
    sistHentet: k.lastSyncedAt?.toISOString() ?? null,
    feil: k.lastError,
    datoer: datoer.map((d) => ({ ...d, etikett: avfallEtikett(d.fraksjon) })),
  };
}

/**
 * Henter kalenderen og bytter ut de framtidige datoene. Passerte datoer røres ikke — de
 * slettes av seg selv ved neste henting (og vises uansett ikke).
 */
export async function synkBir(db: Db, orgId: string): Promise<{ ok: true; antall: number } | { ok: false; feil: string }> {
  const [k] = await db.select().from(birSettings).where(eq(birSettings.orgId, orgId)).limit(1);
  if (!k) return { ok: false, feil: "Ikke koblet til BIR" };

  let datoer;
  try {
    datoer = await hentKalender(k.birId);
  } catch (e) {
    const feil = e instanceof BirFeil ? e.message : "Uventet feil ved henting fra BIR";
    if (!(e instanceof BirFeil)) console.error("[bir] Uventet feil:", e);
    await db.update(birSettings).set({ lastError: feil }).where(eq(birSettings.orgId, orgId));
    return { ok: false, feil };
  }

  const iDag = osloIDag();
  const framover = datoer.filter((d) => d.dato >= iDag);
  await db.delete(birPickups).where(eq(birPickups.orgId, orgId));
  if (framover.length > 0) {
    await db
      .insert(birPickups)
      .values(framover.map((d) => ({ id: randomUUID(), orgId, fraction: d.fraksjon, pickupDate: d.dato })))
      .onConflictDoNothing();
  }
  await db
    .update(birSettings)
    .set({ lastSyncedAt: new Date(), lastError: null })
    .where(eq(birSettings.orgId, orgId));
  return { ok: true, antall: framover.length };
}

/**
 * Velger BIR-oppføringen og henter kalenderen med en gang. Feiler hentingen, blir koblingen
 * likevel stående med feilen synlig — styret har valgt riktig oppføring, det er BIR som
 * ikke svarer, og jobben prøver igjen i natt.
 */
export async function kobleBir(db: Db, orgId: string, av: Aktor, d: z.infer<typeof birValg>) {
  const verdier = {
    birId: d.id,
    birName: d.navn,
    realEstateId: d.eiendom || null,
    connectedBy: av.navn,
    connectedByUserId: av.brukerId,
    lastSyncedAt: null,
    lastError: null,
  };
  await db
    .insert(birSettings)
    .values({ orgId, ...verdier })
    .onConflictDoUpdate({ target: birSettings.orgId, set: verdier });
  await db.delete(birPickups).where(eq(birPickups.orgId, orgId));
  await loggHendelse(db, orgId, av, {
    modul: "oppslagstavle",
    entitet: "bir",
    entitetId: d.id,
    hendelse: `Koblet tømmedager fra BIR: «${d.navn}»`,
  });
  await synkBir(db, orgId);
  return hentBirStatus(db, orgId);
}

export async function kobleFraBir(db: Db, orgId: string, av: Aktor) {
  const slettet = await db.delete(birSettings).where(eq(birSettings.orgId, orgId)).returning();
  await db.delete(birPickups).where(eq(birPickups.orgId, orgId));
  if (slettet[0]) {
    await loggHendelse(db, orgId, av, {
      modul: "oppslagstavle",
      entitet: "bir",
      entitetId: slettet[0].birId,
      hendelse: `Koblet fra tømmedager fra BIR («${slettet[0].birName}»)`,
    });
  }
}

/**
 * Det skjermen viser: NESTE dato per fraksjon, sortert på dato. `null` = ikke koblet, og da
 * skjules feltet helt i stedet for å vise en tom boks.
 */
export async function tommedagerForSkjerm(db: Db, orgId: string) {
  const [k] = await db.select({ orgId: birSettings.orgId }).from(birSettings).where(eq(birSettings.orgId, orgId)).limit(1);
  if (!k) return null;
  const rader = await db
    .select({ fraksjon: birPickups.fraction, dato: birPickups.pickupDate })
    .from(birPickups)
    .where(and(eq(birPickups.orgId, orgId), gte(birPickups.pickupDate, osloIDag())))
    .orderBy(asc(birPickups.pickupDate));
  const neste = new Map<string, string>();
  for (const r of rader) if (!neste.has(r.fraksjon)) neste.set(r.fraksjon, r.dato);
  return [...neste].map(([fraksjon, dato]) => ({ fraksjon, etikett: avfallEtikett(fraksjon), dato }));
}
