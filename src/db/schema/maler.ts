import { boolean, integer, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

/**
 * HMS-maler — navngitte varianter av vernerunde og risikovurdering.
 *
 * **Dette er PLATTFORMDATA, ikke kundedata.** Samme mal brukes på tvers av alle borettslag,
 * og bare plattformadmin kan endre dem. Tabellene har derfor ingen `org_id`, står utenfor
 * RLS, og nås gjennom `plattformRute()` i stedet for `orgRute()`.
 *
 * Én mal per type er markert som standard. Det er den kunde-appen får når den ikke ber om en
 * bestemt mal, og grunnen til at oppsettet fungerer uendret for kunder som aldri har tatt
 * stilling til malvalg.
 */
export const hmsTemplates = pgTable("hms_templates", {
  id: varchar("id").primaryKey(),
  /** `vernerunde` | `risikovurdering`. */
  templateType: varchar("template_type").notNull(),
  name: varchar("name").notNull(),
  description: text("description"),
  isDefault: boolean("is_default").notNull().default(false),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Seksjon i vernerunde / kategori i risikovurdering. */
export const hmsTemplateCategories = pgTable("hms_template_categories", {
  id: varchar("id").primaryKey(),
  templateId: varchar("template_id").references(() => hmsTemplates.id, { onDelete: "cascade" }),
  /**
   * Arv fra da det fantes én mal per type. `templateId` er det som gjelder nå — kolonnen
   * beholdes fordi gamle rader har verdier i den, og settes fortsatt ved opprettelse så den
   * ikke drifter fra malen den hører til. Ingen spørring filtrerer på den.
   */
  templateType: varchar("template_type").notNull(),
  key: varchar("key").notNull(),
  label: varchar("label").notNull(),
  icon: varchar("icon"),
  order: integer("order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const hmsTemplateItems = pgTable("hms_template_items", {
  id: varchar("id").primaryKey(),
  categoryId: varchar("category_id")
    .notNull()
    .references(() => hmsTemplateCategories.id, { onDelete: "cascade" }),
  text: varchar("text").notNull(),
  order: integer("order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type HmsTemplate = typeof hmsTemplates.$inferSelect;
export type HmsTemplateCategory = typeof hmsTemplateCategories.$inferSelect;
export type HmsTemplateItem = typeof hmsTemplateItems.$inferSelect;
