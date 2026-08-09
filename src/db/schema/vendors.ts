import { boolean, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

/** Leverandør. Direkte tenant-tabell — RLS-policy på org_id. */
export const vendors = pgTable("vendors", {
  id: varchar("id").primaryKey(),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id),
  name: varchar("name").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export type Vendor = typeof vendors.$inferSelect;
