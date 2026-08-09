import { boolean, integer, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

/** Et borettslag eller sameie. Står i UNNTATT — listes på tvers av plattformpanelet. */
export const organizations = pgTable("organizations", {
  id: varchar("id").primaryKey(),
  name: varchar("name").notNull(),
  slug: varchar("slug").notNull().unique(),
  orgNr: varchar("org_nr").unique(),
  orgForm: varchar("org_form"),
  municipality: varchar("municipality"),
  /** Antall boliger/enheter — brukes til kostnad per enhet i vedlikeholdsplanen. */
  unitCount: integer("unit_count"),
  active: boolean("active").notNull().default(true),
  /**
   * JSON-liste med modulnøkler kunden har aktivert. NULL/tom = ingen egen liste ⇒
   * standardsettet i lib/moduler.ts. Se `modulErAktivert()` for hvorfor en ødelagt verdi
   * faller tilbake til standard og ikke til «alt av».
   */
  enabledModules: text("enabled_modules"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type Organization = typeof organizations.$inferSelect;
