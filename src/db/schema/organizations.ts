import { boolean, integer, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

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
  createdAt: timestamp("created_at").defaultNow(),
});

export type Organization = typeof organizations.$inferSelect;
