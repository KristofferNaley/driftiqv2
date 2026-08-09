/**
 * Organisasjonens innstillinger. Port av v1s `routers/organizations.py`.
 *
 * ## Driftsinnhold vs. kontooppsett
 *
 * Noen felter er DRIFTSINNHOLD og kan endres av `redigering`: «Om bygget» er fakta om
 * bygningen som brukes i det daglige (og mates inn i AI-rådgiveren), og `hasEmployees`
 * avgjør hvilke lover internkontrollen må dekke. Alt annet — navn, org.nr., moduler,
 * lagring — er kontooppsett og krever `orgadmin`.
 *
 * Delmengde-sjekken er bevisst STRENG: sendes ett kontofelt med på lasset, gjelder
 * admin-kravet for hele kallet. Ellers kunne en `redigering`-bruker smugle inn en
 * navneendring sammen med et driftsfelt.
 */

import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import { organizations } from "../db/schema/organizations";
import { ikkeFunnet, ugyldig } from "./api";
import { ALLE_MODULER, type ModulNokkel } from "./moduler";

/** Felter `redigering` også kan endre. Alt annet krever `orgadmin`. */
export const DRIFTSFELT = new Set(["buildingInfo", "hasEmployees"]);

export const orgEndring = z.object({
  name: z.string().trim().min(1, "Navn må fylles ut").optional(),
  orgNr: z.string().trim().nullish(),
  orgForm: z.string().trim().nullish(),
  municipality: z.string().trim().nullish(),
  unitCount: z.number().int().min(0).nullish(),
  buildingInfo: z.string().nullish(),
  hasEmployees: z.boolean().optional(),
});

export const modulValg = z.object({
  moduler: z.array(z.enum(ALLE_MODULER)),
});

/** Krever kallet orgadmin, eller holder `redigering`? Se kommentaren øverst. */
export function kreverAdmin(felter: string[]): boolean {
  if (felter.length === 0) return true;
  return !felter.every((f) => DRIFTSFELT.has(f));
}

export async function hentOrg(db: Db, orgId: string) {
  const rader = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  const org = rader[0];
  if (!org) throw ikkeFunnet("Organisasjon");
  return org;
}

export async function endreOrg(db: Db, orgId: string, data: z.infer<typeof orgEndring>) {
  await hentOrg(db, orgId);
  const [endret] = await db
    .update(organizations)
    .set(data)
    .where(eq(organizations.id, orgId))
    .returning();
  return endret!;
}

/**
 * Setter hvilke moduler org-en har.
 *
 * `dashboard` kan ikke slås av og legges alltid til — den er inngangen til alt annet, og en
 * kunde uten den ville hatt en app uten forside.
 */
export async function settModuler(db: Db, orgId: string, valgte: ModulNokkel[]) {
  await hentOrg(db, orgId);
  const med = [...new Set<ModulNokkel>(["dashboard", ...valgte])];
  const [endret] = await db
    .update(organizations)
    .set({ enabledModules: JSON.stringify(med) })
    .where(eq(organizations.id, orgId))
    .returning();
  return endret!;
}

export function lesModuler(lagret: string | null): ModulNokkel[] | null {
  if (!lagret) return null;
  try {
    const liste = JSON.parse(lagret);
    return Array.isArray(liste) ? liste : null;
  } catch {
    // En ødelagt verdi skal ikke krasje innstillingssiden — den skal vise standardsettet,
    // som er nøyaktig det `null` betyr her.
    return null;
  }
}

export function krevGyldigOrgnr(orgNr: string | null | undefined) {
  if (!orgNr) return;
  if (!/^\d{9}$/.test(orgNr.replace(/\s/g, ""))) {
    throw ugyldig("Organisasjonsnummeret må være ni siffer.");
  }
}
