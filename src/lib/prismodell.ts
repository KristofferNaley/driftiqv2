/**
 * Prismodellen — lagring. Port av v1s `/superadmin/pricing-config`.
 *
 * Regnestykket bor i `prisregler.ts`; her er bare databasen. Raden er en singleton med
 * id `default`, og den opprettes ved første oppslag i stedet for i en migrasjon: da har
 * standardverdiene ett hjem (`prisregler.ts`) i stedet for to.
 */

import { desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "../db/client";
import { organizations } from "../db/schema/organizations";
import { platformContracts, pricingConfig, pricingVersions } from "../db/schema/platform";
import type { Aktor } from "./aktor";
import { GAMLE_ALIASER, MENY, TILLEGGSMODULER, modulErAktivert, type ModulNokkel } from "./moduler";
import {
  STANDARDTRINN,
  STANDARD_GULVPRIS,
  STANDARD_MODULPRISER,
  lesModulpriser,
  lesStrengliste,
  lesTrinn,
  type Trinn,
} from "./prisregler";

const RAD_ID = "default";

const trinnInn = z.object({
  fra: z.number().int().min(1),
  til: z.number().int().min(1),
  sats: z.number().int().min(0),
});

export const prismodellInn = z.object({
  gulvpris: z.number().int().min(0),
  trinn: z
    .array(trinnInn)
    .min(1, "Prismodellen må ha minst ett trinn")
    // Et trinn som slutter før det begynner gir negativt antall andeler i beregningen.
    // Zod fanger det her, så det aldri når `grunnpakke()`.
    .refine((t) => t.every((r) => r.til >= r.fra), "Et trinn kan ikke slutte før det begynner"),
  modulpriser: z.record(z.string(), z.number().int().min(0)),
  /** Datoen NYE kunder prises etter den nye versjonen. Eksisterende følger neste fornyelse. */
  gjelderFra: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Ugyldig dato")
    .nullish(),
});

export type Prismodell = {
  gulvpris: number;
  trinn: ReturnType<typeof lesTrinn>;
  modulpriser: Record<string, number>;
  varselmottakere: string[];
  oppdatert: Date | null;
};

/** Henter singleton-raden, og oppretter den med standardverdier hvis den mangler. */
export async function hentPrismodell(db: Db): Promise<Prismodell> {
  const rader = await db.select().from(pricingConfig).where(eq(pricingConfig.id, RAD_ID)).limit(1);
  let rad = rader[0];

  if (!rad) {
    const [ny] = await db
      .insert(pricingConfig)
      .values({
        id: RAD_ID,
        floorPrice: STANDARD_GULVPRIS,
        tiers: JSON.stringify(STANDARDTRINN),
        moduleDefaults: JSON.stringify(STANDARD_MODULPRISER),
        hiddenModules: "[]",
      })
      // To samtidige oppslag ville ellers kollidert på primærnøkkelen. Det er ikke et
      // teoretisk kappløp: panelet og kunde-appens modulfilter leser begge herfra.
      .onConflictDoNothing()
      .returning();
    rad =
      ny ??
      (await db.select().from(pricingConfig).where(eq(pricingConfig.id, RAD_ID)).limit(1))[0]!;
  }

  return {
    gulvpris: rad.floorPrice,
    trinn: lesTrinn(rad.tiers),
    modulpriser: lesModulpriser(rad.moduleDefaults),
    varselmottakere: lesStrengliste(rad.leadsNotifyEmails),
    oppdatert: rad.updatedAt,
  };
}

/** Modulnavnet slik det står i panelet — for endringsnotatene. */
const modulnavn = (nokkel: string) =>
  MENY[nokkel as ModulNokkel]?.etikett ?? nokkel;

/**
 * Autogenerert endringsnotat — «Gulvpris hevet fra 6 000 til 8 000 kr. Internkontroll:
 * 12 000 → 15 000 kr». Skrives av maskinen fordi historikk folk må huske å skrive, ikke
 * blir skrevet. Eksportert for testbarhet.
 */
export function beskrivEndring(
  gammel: { gulvpris: number; trinn: Trinn[]; modulpriser: Record<string, number> },
  ny: { gulvpris: number; trinn: Trinn[]; modulpriser: Record<string, number> },
): string {
  // Hardt mellomrom fra toLocaleString byttes ut — notatet lagres som ren tekst og skal
  // kunne søkes i og siteres uten usynlige spesialtegn.
  const kr = (n: number) => `${n.toLocaleString("nb-NO").replace(/\u00A0/g, " ")} kr`;
  const deler: string[] = [];

  if (ny.gulvpris !== gammel.gulvpris) {
    deler.push(
      `Gulvpris ${ny.gulvpris > gammel.gulvpris ? "hevet" : "senket"} fra ${kr(gammel.gulvpris)} til ${kr(ny.gulvpris)}`,
    );
  }
  if (ny.trinn.length > gammel.trinn.length) {
    deler.push(`Trinn lagt til (${gammel.trinn.length} → ${ny.trinn.length})`);
  } else if (ny.trinn.length < gammel.trinn.length) {
    deler.push(`Trinn fjernet (${gammel.trinn.length} → ${ny.trinn.length})`);
  } else if (JSON.stringify(ny.trinn) !== JSON.stringify(gammel.trinn)) {
    deler.push("Trinnene justert");
  }
  for (const nokkel of new Set([...Object.keys(gammel.modulpriser), ...Object.keys(ny.modulpriser)])) {
    const for_ = gammel.modulpriser[nokkel] ?? 0;
    const naa = ny.modulpriser[nokkel] ?? 0;
    if (for_ !== naa) deler.push(`${modulnavn(nokkel)}: ${kr(for_)} → ${kr(naa)}`);
  }
  return deler.join(". ") || "Ingen endring i satsene";
}

/**
 * Lagrer modellen OG skriver en versjonsrad: snapshot, autogenerert notat om hva som
 * endret seg, og datoen nye kunder prises etter den. Første lagring blir versjon 1.
 */
export async function settPrismodell(db: Db, data: z.infer<typeof prismodellInn>, aktor: Aktor) {
  const gammel = await hentPrismodell(db); // sikrer også at raden finnes

  await db
    .update(pricingConfig)
    .set({
      floorPrice: data.gulvpris,
      tiers: JSON.stringify(data.trinn),
      moduleDefaults: JSON.stringify(data.modulpriser),
      updatedAt: new Date(),
    })
    .where(eq(pricingConfig.id, RAD_ID));

  const [siste] = await db
    .select({ version: pricingVersions.version })
    .from(pricingVersions)
    .orderBy(desc(pricingVersions.version))
    .limit(1);

  await db.insert(pricingVersions).values({
    id: randomUUID(),
    version: (siste?.version ?? 0) + 1,
    floorPrice: data.gulvpris,
    tiers: JSON.stringify(data.trinn),
    moduleDefaults: JSON.stringify(data.modulpriser),
    note: beskrivEndring(gammel, data),
    validFrom: data.gjelderFra ?? new Date().toISOString().slice(0, 10),
    createdBy: aktor.navn,
  });

  return hentPrismodellPanel(db);
}

/**
 * Alt prismodellsiden trenger i ett svar: modellen, versjonshistorikken, og kundene med
 * kontraktdata — konsekvenslinja («hva skjer med eksisterende kunder») regnes i panelet
 * mens man skriver, og det kan den bare gjøre med dagens tall for hånden.
 */
export async function hentPrismodellPanel(db: Db) {
  const [modell, versjoner, orger, avtaler] = await Promise.all([
    hentPrismodell(db),
    db
      .select({
        version: pricingVersions.version,
        note: pricingVersions.note,
        validFrom: pricingVersions.validFrom,
        createdBy: pricingVersions.createdBy,
        createdAt: pricingVersions.createdAt,
      })
      .from(pricingVersions)
      .orderBy(desc(pricingVersions.version)),
    db
      .select({
        id: organizations.id,
        navn: organizations.name,
        andeler: organizations.unitCount,
        enabledModules: organizations.enabledModules,
      })
      .from(organizations)
      // Demo-kunder skal ikke stå som prikker på priskurven eller i konsekvenstabellen.
      .where(eq(organizations.active, true))
      .orderBy(organizations.name),
    db.select().from(platformContracts),
  ]);

  const ekte = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.demo, false));
  const ekteIds = new Set(ekte.map((o) => o.id));

  const avtalePerOrg = new Map(avtaler.map((a) => [a.orgId, a]));
  const kunder = orger
    .filter((o) => ekteIds.has(o.id))
    .map((o) => {
      const avtale = avtalePerOrg.get(o.id);
      let moduler: Array<{ key?: string; price?: number }> = [];
      try {
        const t = JSON.parse(avtale?.modules ?? "[]");
        if (Array.isArray(t)) moduler = t;
      } catch {
        // Ødelagt JSON teller som ingen moduler — konsekvenslinja skal ikke velte av én rad.
      }
      const brutto = avtale
        ? (avtale.baseFee ?? avtale.annualFee ?? 0) + moduler.reduce((n, m) => n + (m.price ?? 0), 0)
        : null;
      const rabatt = avtale?.discountPercent ?? 0;
      return {
        id: o.id,
        navn: o.navn,
        andeler: o.andeler,
        arssum: brutto === null ? null : Math.round(brutto * (1 - rabatt / 100)),
        rabattProsent: rabatt,
        // Gamle v1-nøkler («vedlikeholdsplan») normaliseres, så oppslaget mot de NYE
        // modulprisene treffer.
        moduler: moduler
          .map((m) => m.key)
          .filter((k): k is string => Boolean(k))
          .map((k) => ALIAS_TIL_NOKKEL.get(k) ?? k),
      };
    });

  // «Aktiv hos N kunder» per tilleggsmodul — argumentet for prisen ved siden av prisen.
  const modulKunder: Record<string, number> = {};
  for (const m of TILLEGGSMODULER) {
    modulKunder[m] = orger.filter(
      (o) => ekteIds.has(o.id) && modulErAktivert(o.enabledModules, m),
    ).length;
  }

  return { ...modell, versjoner, kunder, modulKunder };
}

const ALIAS_TIL_NOKKEL: ReadonlyMap<string, string> = new Map(
  (Object.entries(GAMLE_ALIASER) as Array<[string, readonly string[]]>).flatMap(([ny, gamle]) =>
    (gamle ?? []).map((g) => [g, ny] as [string, string]),
  ),
);

export const varselmottakereInn = z.object({
  epostadresser: z.array(z.string().trim().toLowerCase().email("Ugyldig e-postadresse")),
});

/**
 * Hvem som varsles om nye leads og innmeldinger.
 *
 * Tom liste = fall tilbake på miljøvariabelen, slik det var før lista fantes. Kallstedet
 * håndterer det; her lagres tomt som tomt.
 */
/**
 * Adressene et lead- eller feilmeldingsvarsel faktisk skal til: lista fra panelet, eller
 * `LEADS_NOTIFY_EMAIL` når lista er tom — slik det var før lista fantes. Fallbacken ligger
 * her og ikke i epost.ts, så e-postlaget slipper å kjenne miljøvariabelen.
 */
export async function plattformVarslingsadresser(db: Db): Promise<string[]> {
  const lagret = (await hentPrismodell(db)).varselmottakere;
  if (lagret.length > 0) return lagret;
  const env = process.env.LEADS_NOTIFY_EMAIL?.trim();
  return env ? [env] : [];
}

export async function settVarselmottakere(db: Db, epostadresser: string[]) {
  await hentPrismodell(db);
  // Duplikater ville gitt samme person to like e-poster.
  const unike = [...new Set(epostadresser)];
  await db
    .update(pricingConfig)
    .set({ leadsNotifyEmails: JSON.stringify(unike), updatedAt: new Date() })
    .where(eq(pricingConfig.id, RAD_ID));
  return unike;
}
