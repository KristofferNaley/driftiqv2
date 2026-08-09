/**
 * Prismodellen — lagring. Port av v1s `/superadmin/pricing-config`.
 *
 * Regnestykket bor i `prisregler.ts`; her er bare databasen. Raden er en singleton med
 * id `default`, og den opprettes ved første oppslag i stedet for i en migrasjon: da har
 * standardverdiene ett hjem (`prisregler.ts`) i stedet for to.
 */

import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import { pricingConfig } from "../db/schema/platform";
import {
  STANDARDTRINN,
  STANDARD_GULVPRIS,
  STANDARD_MODULPRISER,
  lesModulpriser,
  lesStrengliste,
  lesTrinn,
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
  skjulteModuler: z.array(z.string()),
});

export type Prismodell = {
  gulvpris: number;
  trinn: ReturnType<typeof lesTrinn>;
  modulpriser: Record<string, number>;
  skjulteModuler: string[];
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
    skjulteModuler: lesStrengliste(rad.hiddenModules),
    varselmottakere: lesStrengliste(rad.leadsNotifyEmails),
    oppdatert: rad.updatedAt,
  };
}

export async function settPrismodell(db: Db, data: z.infer<typeof prismodellInn>) {
  await hentPrismodell(db); // sikrer at raden finnes
  await db
    .update(pricingConfig)
    .set({
      floorPrice: data.gulvpris,
      tiers: JSON.stringify(data.trinn),
      moduleDefaults: JSON.stringify(data.modulpriser),
      hiddenModules: JSON.stringify(data.skjulteModuler),
      updatedAt: new Date(),
    })
    .where(eq(pricingConfig.id, RAD_ID));
  return hentPrismodell(db);
}

/**
 * Modulnøklene som er midlertidig skjult.
 *
 * Egen funksjon fordi dette er det ENESTE fra prismodellen en vanlig innlogget bruker får
 * se — satser og trappetrinn er forretningsdata en kunde aldri skal ha. Samme skille som
 * v1s `routers/platform_settings.py`, som ble skilt ut fra superadmin-ruteren nettopp her.
 */
export async function hentSkjulteModuler(db: Db): Promise<string[]> {
  const rader = await db
    .select({ skjulte: pricingConfig.hiddenModules })
    .from(pricingConfig)
    .where(eq(pricingConfig.id, RAD_ID))
    .limit(1);
  // Ingen rad ⇒ ingenting er skjult. Oppretter den ikke her: en leserute skal ikke skrive.
  return lesStrengliste(rader[0]?.skjulte);
}

export const varselmottakereInn = z.object({
  epostadresser: z.array(z.string().trim().toLowerCase().email("Ugyldig e-postadresse")),
});

/**
 * Hvem som varsles om nye leads og innmeldinger.
 *
 * Tom liste = fall tilbake på miljøvariabelen, slik det var før lista fantes. Kallstedet
 * håndterer det; her lagres tomt som tomt.
 */
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
