/**
 * Innholdsblokker med egne innstillinger: vær for et sted (MET/yr) og avganger fra en eller
 * to holdeplasser (Entur). Styret lager dem under «Nytt innhold» og plasserer dem i sonene
 * per skjerm. Designnotatet er `docs/entur-yr.md`.
 *
 * HTTP og mellomlager ligger i `entur.ts` og `yr.ts`. Her er databasen og det skjermen får.
 * Dataene hentes aldri av skjermen selv — og mellomlagrene gjør at ti skjermer på samme
 * holdeplass eller sted gir ett kall, ikke ti.
 */

import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import { boardBlocks, boardScreens, type BoardBlock } from "../db/schema/oppslagstavle";
import { ApiFeil, ikkeFunnet, ugyldig } from "./api";
import type { Aktor } from "./aktor";
import { EnturFeil, avgangerFra, erHoldeplassId, sokHoldeplass, type Holdeplasstreff } from "./entur";
import { sokSted } from "./kartverket";
import { blokkNokkel } from "./tavlemaler";
import type { Blokkdata } from "./oppslagstavleregler";
import { AVGANGER_PER_HOLDEPLASS, MAKS_HOLDEPLASSER, VAERVISNINGER, type Vaervisning } from "./vaerregler";
import { rundAv, varselFor } from "./yr";

export const BLOKKTYPER = ["vaer", "avganger"] as const;
export type Blokktype = (typeof BLOKKTYPER)[number];

const vaerKonfig = z.object({
  sted: z.string().trim().min(1).max(120),
  // Norge med Svalbard og litt margin — et punkt utenfor er en feil, ikke et borettslag.
  lat: z.number().min(57).max(81),
  lon: z.number().min(4).max(32),
  visning: z.enum(VAERVISNINGER),
});

const avgangerKonfig = z.object({
  holdeplasser: z
    .array(z.object({ id: z.string().refine(erHoldeplassId, "Ugyldig holdeplass-id"), navn: z.string().trim().min(1).max(80) }))
    .min(1, "Velg minst én holdeplass")
    .max(MAKS_HOLDEPLASSER, `Maks ${MAKS_HOLDEPLASSER} holdeplasser per blokk — flere får ikke plass`),
});

export const blokkInn = z.discriminatedUnion("type", [
  z.object({ type: z.literal("vaer"), navn: z.string().trim().min(1).max(60), konfig: vaerKonfig }),
  z.object({ type: z.literal("avganger"), navn: z.string().trim().min(1).max(60), konfig: avgangerKonfig }),
]);
export type BlokkInn = z.infer<typeof blokkInn>;

/** Konfigurasjonen fra en rad, validert på nytt — en ødelagt rad blir `null`, ikke en krasj. */
function lesKonfig(b: BoardBlock) {
  let raa: unknown;
  try {
    raa = JSON.parse(b.config);
  } catch {
    return null;
  }
  const r = blokkInn.safeParse({ type: b.kind, navn: b.name, konfig: raa });
  return r.success ? r.data : null;
}

const blokkUt = (b: BoardBlock) => {
  const k = lesKonfig(b);
  return { id: b.id, nokkel: blokkNokkel(b.id), type: b.kind as Blokktype, navn: b.name, konfig: k?.konfig ?? null };
};

export async function hentBlokker(db: Db, orgId: string) {
  const rader = await db
    .select()
    .from(boardBlocks)
    .where(eq(boardBlocks.orgId, orgId))
    .orderBy(asc(boardBlocks.createdAt));
  return rader.map(blokkUt);
}

function normaliser(d: BlokkInn): BlokkInn {
  // MET ber om høyst fire desimaler — det gir treff i hurtigbufferen deres og vår.
  return d.type === "vaer" ? { ...d, konfig: { ...d.konfig, lat: rundAv(d.konfig.lat), lon: rundAv(d.konfig.lon) } } : d;
}

export async function opprettBlokk(db: Db, orgId: string, av: Aktor, d: BlokkInn) {
  const n = normaliser(d);
  const [rad] = await db
    .insert(boardBlocks)
    .values({
      id: randomUUID(),
      orgId,
      kind: n.type,
      name: n.navn,
      config: JSON.stringify(n.konfig),
      createdBy: av.navn,
      createdByUserId: av.brukerId,
    })
    .returning();
  return blokkUt(rad!);
}

export async function endreBlokk(db: Db, orgId: string, id: string, d: BlokkInn) {
  const [gammel] = await db
    .select({ kind: boardBlocks.kind })
    .from(boardBlocks)
    .where(and(eq(boardBlocks.id, id), eq(boardBlocks.orgId, orgId)))
    .limit(1);
  if (!gammel) throw ikkeFunnet("Blokk");
  if (gammel.kind !== d.type) throw ugyldig("Typen til en blokk kan ikke endres — lag en ny blokk");
  const n = normaliser(d);
  const [rad] = await db
    .update(boardBlocks)
    .set({ name: n.navn, config: JSON.stringify(n.konfig) })
    .where(and(eq(boardBlocks.id, id), eq(boardBlocks.orgId, orgId)))
    .returning();
  return blokkUt(rad!);
}

/**
 * Sletter blokken og fjerner den fra sonene på alle skjermene i orgen. `lesSoner` ville
 * ignorert den uansett, men en død nøkkel i lagret JSON er rot noen snubler i senere.
 */
export async function slettBlokk(db: Db, orgId: string, id: string) {
  const slettet = await db
    .delete(boardBlocks)
    .where(and(eq(boardBlocks.id, id), eq(boardBlocks.orgId, orgId)))
    .returning({ id: boardBlocks.id });
  if (slettet.length === 0) throw ikkeFunnet("Blokk");
  const nokkel = blokkNokkel(id);
  const skjermer = await db
    .select({ id: boardScreens.id, zones: boardScreens.zones })
    .from(boardScreens)
    .where(eq(boardScreens.orgId, orgId));
  for (const s of skjermer) {
    if (!s.zones?.includes(nokkel)) continue;
    let soner: Record<string, unknown>;
    try {
      soner = JSON.parse(s.zones) as Record<string, unknown>;
    } catch {
      continue;
    }
    const rent = Object.fromEntries(
      Object.entries(soner).map(([k, v]) => [k, Array.isArray(v) ? v.filter((x) => x !== nokkel) : v]),
    );
    await db
      .update(boardScreens)
      .set({ zones: JSON.stringify(rent) })
      .where(and(eq(boardScreens.id, s.id), eq(boardScreens.orgId, orgId)));
  }
}

// ---------------------------------------------------------------------------------------
// Søk (proxy — nettleseren kaller aldri Entur eller Kartverket selv)
// ---------------------------------------------------------------------------------------

/** Nettfeil blir 503 — aldri 502/504 (CLAUDE.md «Fallgruver»). */
export async function sokHoldeplasser(q: string): Promise<Holdeplasstreff[]> {
  if (q.trim().length < 2) throw ugyldig("Skriv minst to tegn");
  try {
    return await sokHoldeplass(q.trim());
  } catch (e) {
    if (e instanceof EnturFeil) throw new ApiFeil(503, e.message);
    throw e;
  }
}

export const sokVaersted = sokSted;

// ---------------------------------------------------------------------------------------
// Det skjermen får
// ---------------------------------------------------------------------------------------

/**
 * Dataene for de egne blokkene som faktisk står i en sone på skjermen — ikke alle orgens
 * blokker, så en skjerm uten vær aldri henter vær. Nøkkel er `blokk:<id>`.
 */
export async function blokkdataForSkjerm(
  db: Db,
  orgId: string,
  nokler: ReadonlySet<string>,
  naa = new Date(),
): Promise<Record<string, Blokkdata>> {
  const blokker = (await hentBlokker(db, orgId)).filter((b) => nokler.has(b.nokkel));
  const ut: Record<string, Blokkdata> = {};
  await Promise.all(
    blokker.map(async (b) => {
      if (b.type === "vaer" && b.konfig && "lat" in b.konfig) {
        const v = await varselFor(b.konfig.lat, b.konfig.lon, naa);
        ut[b.nokkel] = { type: "vaer", navn: b.navn, sted: b.konfig.sted, visning: b.konfig.visning as Vaervisning, varsel: v };
      } else if (b.type === "avganger" && b.konfig && "holdeplasser" in b.konfig) {
        ut[b.nokkel] = {
          type: "avganger",
          navn: b.navn,
          holdeplasser: await Promise.all(
            b.konfig.holdeplasser.map(async (h) => ({
              navn: h.navn,
              // Mellomlageret kan være et halvt minutt gammelt — avganger som har gått, ut.
              avganger: (await avgangerFra(h.id, AVGANGER_PER_HOLDEPLASS + 2, naa.getTime()))
                .filter((a) => new Date(a.tid).getTime() > naa.getTime() - 30_000)
                .slice(0, AVGANGER_PER_HOLDEPLASS),
            })),
          ),
        };
      }
    }),
  );
  return ut;
}
