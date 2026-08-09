/**
 * HMS-maler — port av v1s `routers/templates.py`.
 *
 * Plattformdata: samme mal på tvers av alle borettslag, kun plattformadmin kan endre.
 * Lesetilgangen er åpen for innloggede brukere fordi kunde-appen må hente spørsmålslista.
 * Rutene bruker `plattformRute()`, ikke `orgRute()` — det finnes ingen org-kontekst her.
 */

import { and, asc, eq, ne } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "../db/client";
import { hmsTemplateCategories, hmsTemplateItems, hmsTemplates } from "../db/schema/maler";
import { ikkeFunnet, ugyldig } from "./api";

export const MALTYPER = ["vernerunde", "risikovurdering"] as const;
export type Maltype = (typeof MALTYPER)[number];

export const malInn = z.object({
  templateType: z.enum(MALTYPER),
  name: z.string().trim().min(1, "Navn må fylles ut"),
  description: z.string().nullish(),
  isDefault: z.boolean().default(false),
  active: z.boolean().default(true),
});

export const malEndring = malInn.partial().omit({ templateType: true });

export const kategoriInn = z.object({
  key: z.string().trim().min(1, "Nøkkel må fylles ut"),
  label: z.string().trim().min(1, "Etikett må fylles ut"),
  icon: z.string().trim().nullish(),
  order: z.number().int().min(0).default(0),
});

export const punktInn = z.object({
  text: z.string().trim().min(1, "Teksten kan ikke være tom"),
  order: z.number().int().min(0).default(0),
});

/** Kun én standardmal per type. Settes en ny, mister den forrige merket. */
async function fjernAndreStandarder(db: Db, type: string, utenom?: string) {
  const betingelser = [eq(hmsTemplates.templateType, type), eq(hmsTemplates.isDefault, true)];
  if (utenom) betingelser.push(ne(hmsTemplates.id, utenom));
  await db.update(hmsTemplates).set({ isDefault: false }).where(and(...betingelser));
}

export async function hentMaler(db: Db, type?: Maltype) {
  const betingelser = type ? [eq(hmsTemplates.templateType, type)] : [];
  return db
    .select()
    .from(hmsTemplates)
    .where(betingelser.length > 0 ? and(...betingelser) : undefined)
    .orderBy(asc(hmsTemplates.templateType), asc(hmsTemplates.name));
}

/**
 * Malen kunde-appen får når den ikke ber om en bestemt.
 *
 * Faller tilbake på den eldste aktive hvis ingen er merket som standard — ellers ville en
 * kunde fått en tom spørsmålsliste fordi noen glemte å sette flagget, og vernerunden ville
 * sett ut som om den ikke hadde noen punkter.
 */
export async function hentStandardmal(db: Db, type: Maltype) {
  const merket = await db
    .select()
    .from(hmsTemplates)
    .where(and(eq(hmsTemplates.templateType, type), eq(hmsTemplates.isDefault, true), eq(hmsTemplates.active, true)))
    .limit(1);
  if (merket[0]) return hentMal(db, merket[0].id);

  const fallback = await db
    .select()
    .from(hmsTemplates)
    .where(and(eq(hmsTemplates.templateType, type), eq(hmsTemplates.active, true)))
    .orderBy(asc(hmsTemplates.createdAt))
    .limit(1);
  if (!fallback[0]) throw ikkeFunnet(`Mal for ${type}`);
  return hentMal(db, fallback[0].id);
}

/** Malen med kategoriene og punktene sine, i visningsrekkefølge. */
export async function hentMal(db: Db, malId: string) {
  const rader = await db.select().from(hmsTemplates).where(eq(hmsTemplates.id, malId)).limit(1);
  const mal = rader[0];
  if (!mal) throw ikkeFunnet("Mal");

  const kategorier = await db
    .select()
    .from(hmsTemplateCategories)
    .where(eq(hmsTemplateCategories.templateId, malId))
    .orderBy(asc(hmsTemplateCategories.order));

  // Alle punktene i én spørring, ikke én per kategori.
  const punkter = kategorier.length
    ? await db
        .select()
        .from(hmsTemplateItems)
        .orderBy(asc(hmsTemplateItems.order))
    : [];

  const perKategori = new Map<string, typeof punkter>();
  for (const p of punkter) {
    if (!kategorier.some((k) => k.id === p.categoryId)) continue;
    perKategori.set(p.categoryId, [...(perKategori.get(p.categoryId) ?? []), p]);
  }

  return {
    ...mal,
    kategorier: kategorier.map((k) => ({ ...k, punkter: perKategori.get(k.id) ?? [] })),
  };
}

export async function opprettMal(db: Db, data: z.infer<typeof malInn>) {
  const id = randomUUID();
  if (data.isDefault) await fjernAndreStandarder(db, data.templateType);
  const [ny] = await db.insert(hmsTemplates).values({ id, ...data }).returning();
  return ny!;
}

export async function endreMal(db: Db, malId: string, data: z.infer<typeof malEndring>) {
  const rader = await db.select().from(hmsTemplates).where(eq(hmsTemplates.id, malId)).limit(1);
  const mal = rader[0];
  if (!mal) throw ikkeFunnet("Mal");

  if (data.isDefault) await fjernAndreStandarder(db, mal.templateType, malId);
  // En standardmal kan ikke deaktiveres uten at en annen tar over — ellers står typen uten
  // standard, og kunde-appen faller tilbake til noe vilkårlig.
  if (data.active === false && mal.isDefault) {
    throw ugyldig("Standardmalen kan ikke deaktiveres. Sett en annen mal som standard først.");
  }

  const [endret] = await db.update(hmsTemplates).set(data).where(eq(hmsTemplates.id, malId)).returning();
  return endret!;
}

export async function slettMal(db: Db, malId: string) {
  const rader = await db.select().from(hmsTemplates).where(eq(hmsTemplates.id, malId)).limit(1);
  const mal = rader[0];
  if (!mal) throw ikkeFunnet("Mal");
  if (mal.isDefault) {
    throw ugyldig("Standardmalen kan ikke slettes. Sett en annen mal som standard først.");
  }
  await db.delete(hmsTemplates).where(eq(hmsTemplates.id, malId));
}

export async function leggTilKategori(db: Db, malId: string, data: z.infer<typeof kategoriInn>) {
  const rader = await db.select().from(hmsTemplates).where(eq(hmsTemplates.id, malId)).limit(1);
  const mal = rader[0];
  if (!mal) throw ikkeFunnet("Mal");

  const [ny] = await db
    .insert(hmsTemplateCategories)
    // `templateType` settes fra malen så den ikke drifter — se kommentaren på kolonnen.
    .values({ id: randomUUID(), templateId: malId, templateType: mal.templateType, ...data })
    .returning();
  return ny!;
}

export async function endreKategori(
  db: Db,
  kategoriId: string,
  data: Partial<z.infer<typeof kategoriInn>>,
) {
  const [endret] = await db
    .update(hmsTemplateCategories)
    .set(data)
    .where(eq(hmsTemplateCategories.id, kategoriId))
    .returning();
  if (!endret) throw ikkeFunnet("Kategori");
  return endret;
}

export async function slettKategori(db: Db, kategoriId: string) {
  const slettet = await db
    .delete(hmsTemplateCategories)
    .where(eq(hmsTemplateCategories.id, kategoriId))
    .returning({ id: hmsTemplateCategories.id });
  if (slettet.length === 0) throw ikkeFunnet("Kategori");
}

export async function leggTilPunkt(db: Db, kategoriId: string, data: z.infer<typeof punktInn>) {
  const finnes = await db
    .select({ id: hmsTemplateCategories.id })
    .from(hmsTemplateCategories)
    .where(eq(hmsTemplateCategories.id, kategoriId))
    .limit(1);
  if (finnes.length === 0) throw ikkeFunnet("Kategori");

  const [ny] = await db
    .insert(hmsTemplateItems)
    .values({ id: randomUUID(), categoryId: kategoriId, ...data })
    .returning();
  return ny!;
}

export async function endrePunkt(db: Db, punktId: string, data: Partial<z.infer<typeof punktInn>>) {
  const [endret] = await db
    .update(hmsTemplateItems)
    .set(data)
    .where(eq(hmsTemplateItems.id, punktId))
    .returning();
  if (!endret) throw ikkeFunnet("Punkt");
  return endret;
}

export async function slettPunkt(db: Db, punktId: string) {
  const slettet = await db
    .delete(hmsTemplateItems)
    .where(eq(hmsTemplateItems.id, punktId))
    .returning({ id: hmsTemplateItems.id });
  if (slettet.length === 0) throw ikkeFunnet("Punkt");
}
