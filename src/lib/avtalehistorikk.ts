/**
 * Avtalehistorikken (`platform_contract_versions`) — sporet etter `platform_contracts`, som
 * alltid er GJELDENDE avtale og overskrives ved lagring (BL-182).
 *
 * Statistikk trenger «avtalt årlig inntekt» for måneder bak oss. Den kan ikke leses av dagens
 * kontrakt: en rabatt som ble fjernet i mars, ville sett ut som om den aldri fantes. Hver
 * lagring og sletting av avtalen skriver derfor her, i SAMME transaksjon.
 *
 * Regelen: en versjon gjelder dato d når `validFrom <= d < validTo` (`validTo` eksklusiv,
 * NULL = gjelder fortsatt). Datoene er kalenderdager i norsk tid.
 *
 * Prisen regnes med `arssum` fra `lib/prisregler.ts` — samme funksjon som viser «Sum per
 * år» i panelet, så historikken og abonnementsfanen aldri kan være uenige om et beløp.
 */

import { and, desc, eq, gt, gte, isNull, notExists, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { withoutRls, type Db } from "../db/client";
import { platformContracts, platformContractVersions } from "../db/schema/platform";
import { osloDato } from "./idag";
import { arssum } from "./prisregler";

type Avtale = {
  baseFee: number | null;
  annualFee: number | null;
  modules: string | null;
  discountPercent: number;
  startDate: string | null;
  endDate: string | null;
};

/** Avtalt årssum etter rabatt. Ødelagt modul-JSON teller som ingen moduler, som i kundelista. */
export function avtaltArssum(a: Pick<Avtale, "baseFee" | "annualFee" | "modules" | "discountPercent">): number {
  let moduler: Array<{ price?: number }> = [];
  try {
    const t = JSON.parse(a.modules ?? "[]");
    if (Array.isArray(t)) moduler = t;
  } catch {
    // Historikken skal ikke velte av én rad.
  }
  return arssum({
    grunnpakke: a.baseFee,
    arsavgift: a.annualFee,
    moduler: moduler.map((m) => ({ pris: m.price ?? 0 })),
    rabattProsent: a.discountPercent,
  });
}

/** Dagen etter `dato` («2026-12-31» → «2027-01-01»). Ren kalenderregning i UTC. */
function dagenEtter(dato: string): string {
  const d = new Date(`${dato}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Fører avtalen slik den nettopp ble lagret inn i historikken.
 *
 * - Første versjon for kunden gjelder fra avtalens startdato (en avtale som registreres i
 *   ettertid, skal telle fra da den faktisk startet), ellers fra i dag.
 * - En senere endring gjelder fra i dag — eller fra startdatoen hvis den ligger fram i tid.
 *   Historikken skrives ikke om bakover: det som ble avtalt i fjor, var det som gjaldt.
 * - Versjoner som ennå ikke har trådt i kraft, erstattes. Den som gjelder, avsluttes.
 * - Sluttdatoen er siste dag avtalen gjelder; `validTo` blir dagen etter.
 * - Endres verken beløp, rabatt eller sluttdato (bare notat eller fornyelsesdato), skrives
 *   ingenting — ellers ville hvert notat blitt en ny versjon.
 */
export async function forAvtaleversjon(db: Db, orgId: string, avtale: Avtale, naa = new Date()) {
  const idag = osloDato(naa);
  const belop = avtaltArssum(avtale);
  const til = avtale.endDate ? dagenEtter(avtale.endDate) : null;

  const eksisterende = await db
    .select()
    .from(platformContractVersions)
    .where(eq(platformContractVersions.orgId, orgId));

  const gjeldende = eksisterende.find(
    (v) => v.validFrom <= idag && (v.validTo === null || v.validTo > idag),
  );
  if (
    gjeldende &&
    gjeldende.annualAmount === belop &&
    gjeldende.discountPercent === avtale.discountPercent &&
    gjeldende.validTo === til
  ) {
    return;
  }

  const fra =
    eksisterende.length === 0
      ? (avtale.startDate ?? idag)
      : avtale.startDate && avtale.startDate > idag
        ? avtale.startDate
        : idag;

  // Ikke trådt i kraft ennå: erstattes helt.
  await db
    .delete(platformContractVersions)
    .where(and(eq(platformContractVersions.orgId, orgId), gte(platformContractVersions.validFrom, fra)));
  // Gjelder fortsatt etter `fra`: avsluttes der den nye tar over.
  await db
    .update(platformContractVersions)
    .set({ validTo: fra })
    .where(
      and(
        eq(platformContractVersions.orgId, orgId),
        or(isNull(platformContractVersions.validTo), gt(platformContractVersions.validTo, fra)),
      ),
    );

  // En avtale som allerede er utløpt når den lagres, har ingen periode å føre.
  if (til !== null && til <= fra) return;

  await db.insert(platformContractVersions).values({
    id: randomUUID(),
    orgId,
    annualAmount: belop,
    discountPercent: avtale.discountPercent,
    validFrom: fra,
    validTo: til,
  });
}

/**
 * Avtalen er slettet: det som gjelder, avsluttes i dag, og det som ikke har trådt i kraft,
 * fjernes. Historikken før i dag blir stående — inntekten fantes.
 */
export async function avsluttAvtalehistorikk(db: Db, orgId: string, naa = new Date()) {
  const idag = osloDato(naa);
  await db
    .delete(platformContractVersions)
    .where(and(eq(platformContractVersions.orgId, orgId), gte(platformContractVersions.validFrom, idag)));
  await db
    .update(platformContractVersions)
    .set({ validTo: idag })
    .where(
      and(
        eq(platformContractVersions.orgId, orgId),
        or(isNull(platformContractVersions.validTo), gt(platformContractVersions.validTo, idag)),
      ),
    );
}

/**
 * Engangsutfylling for avtaler som fantes før historikken (BL-182). Kjøres ved hver oppstart
 * av `scripts/oppstart.ts`, men rører bare kunder som har avtale og INGEN historikk — altså
 * ingen etter første kjøring.
 *
 * Antakelsen er at dagens avtalte pris har gjeldt siden startdatoen (eller siden avtalen ble
 * registrert, når startdato mangler). Mer vet vi ikke: kontrakten ble overskrevet ved hver
 * lagring. Avklart med eier 01.10.2026.
 *
 * TypeScript og ikke SQL for å bruke samme `arssum` som panelet (mønster: tavlemigrering).
 * `orgId` avgrenser til én kunde — for testene, som ikke skal røre andres rader.
 */
export async function fyllAvtalehistorikk(db: Db, orgId?: string): Promise<number> {
  const utenHistorikk = notExists(
    db
      .select({ en: sql`1` })
      .from(platformContractVersions)
      .where(eq(platformContractVersions.orgId, platformContracts.orgId)),
  );
  const avtaler = await db
    .select()
    .from(platformContracts)
    .where(orgId ? and(utenHistorikk, eq(platformContracts.orgId, orgId)) : utenHistorikk)
    .orderBy(desc(platformContracts.createdAt));

  // Bare den nyeste avtalen per kunde — samme regel som `hentAbonnement`.
  const sett = new Set<string>();
  let antall = 0;
  for (const a of avtaler) {
    if (sett.has(a.orgId)) continue;
    sett.add(a.orgId);
    const fra = a.startDate ?? osloDato(a.createdAt);
    const til = a.endDate ? dagenEtter(a.endDate) : null;
    if (til !== null && til <= fra) continue;
    await db.insert(platformContractVersions).values({
      id: randomUUID(),
      orgId: a.orgId,
      annualAmount: avtaltArssum(a),
      discountPercent: a.discountPercent,
      validFrom: fra,
      validTo: til,
    });
    antall++;
  }
  return antall;
}

export const kjorAvtalehistorikk = (orgId?: string) =>
  withoutRls("migrasjon", (db) => fyllAvtalehistorikk(db, orgId));
