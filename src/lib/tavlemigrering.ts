/**
 * Engangsmigrering 30.09.2026: fra plassering per blokk (`board_placements`) til felt per
 * skjerm (`board_screens.zones`). Kjøres ved hver oppstart av `scripts/oppstart.ts`, etter
 * SQL-migrasjonene, og rører bare skjermer der `zones` er `null` — altså ingen etter første
 * kjøring.
 *
 * Skrevet i TypeScript og ikke SQL for å bruke SAMME `fordelSoner` som regnet ut sonene før:
 * skjermen viser da det samme etterpå som før, per konstruksjon. En SQL-kopi av regelen ville
 * vært en ny tolkning av den.
 */

import { and, asc, eq, isNull } from "drizzle-orm";
import { withoutRls, type Db } from "../db/client";
import { boardBlocks, boardPlacements, boardScreens } from "../db/schema/oppslagstavle";
import { RETNINGER, type Retning } from "./oppslagstavleregler";
import {
  INNEBYGDE_BLOKKER,
  OMRADER,
  SIDE_REKKEFOLGE,
  STANDARD_PLASSERING,
  blokkNokkel,
  finnMal,
  fordelSoner,
  type Felt,
  type InnebygdBlokk,
  type Omrade,
} from "./tavlemaler";

type Plassering = { nokkel: string; omrade: Omrade; alleSkjermer: boolean; skjermIder: string[] };

/** Plasseringen for hver blokk i orgen slik den gjaldt: lagret rad, ellers standarden. */
async function plasseringerFor(db: Db, orgId: string): Promise<Plassering[]> {
  const [egne, lagret] = await Promise.all([
    db.select({ id: boardBlocks.id }).from(boardBlocks).where(eq(boardBlocks.orgId, orgId)).orderBy(asc(boardBlocks.createdAt)),
    db.select().from(boardPlacements).where(eq(boardPlacements.orgId, orgId)),
  ]);
  const nokler = [...INNEBYGDE_BLOKKER, ...egne.map((b) => blokkNokkel(b.id))].sort(
    (a, b) => SIDE_REKKEFOLGE(a) - SIDE_REKKEFOLGE(b),
  );
  const perNokkel = new Map(lagret.map((p) => [p.blockKey, p]));
  return nokler.map((nokkel) => {
    const p = perNokkel.get(nokkel);
    const omrade = p && (OMRADER as readonly string[]).includes(p.area) ? (p.area as Omrade) : null;
    return {
      nokkel,
      omrade: omrade ?? STANDARD_PLASSERING[nokkel as InnebygdBlokk] ?? "side",
      alleSkjermer: p?.allScreens ?? true,
      skjermIder: p?.screenIds ?? [],
    };
  });
}

/** Feltene én skjerm hadde med den gamle modellen. */
export function feltFraPlasseringer(
  skjerm: { id: string; layout: string | null; orientation: string },
  plasseringer: readonly Plassering[],
): Felt {
  const retning = (RETNINGER as readonly string[]).includes(skjerm.orientation) ? (skjerm.orientation as Retning) : "staende";
  return fordelSoner(
    finnMal(skjerm.layout, retning),
    plasseringer
      .filter((p) => p.omrade !== "av" && (p.alleSkjermer || p.skjermIder.includes(skjerm.id)))
      .map((p) => ({ nokkel: p.nokkel, omrade: p.omrade })),
  );
}

/**
 * Fyller `zones` for skjermene som mangler det. Returnerer antallet som ble migrert.
 * `orgId` avgrenser til ett borettslag — for testene, som ikke skal røre andres rader.
 */
export async function migrerPlasseringerTilFelt(db: Db, orgId?: string): Promise<number> {
  const skjermer = await db
    .select()
    .from(boardScreens)
    .where(orgId ? and(isNull(boardScreens.zones), eq(boardScreens.orgId, orgId)) : isNull(boardScreens.zones));
  const perOrg = new Map<string, Plassering[]>();
  for (const s of skjermer) {
    if (!perOrg.has(s.orgId)) perOrg.set(s.orgId, await plasseringerFor(db, s.orgId));
    await db
      .update(boardScreens)
      .set({ zones: feltFraPlasseringer(s, perOrg.get(s.orgId)!) })
      .where(eq(boardScreens.id, s.id));
  }
  return skjermer.length;
}

export const kjorFeltmigrering = (orgId?: string) => withoutRls("migrasjon", (db) => migrerPlasseringerTilFelt(db, orgId));
