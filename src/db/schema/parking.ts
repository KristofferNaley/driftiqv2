import { date, integer, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

/**
 * Parkering. Tre direkte tenant-tabeller — alle har egen `org_id` og RLS-policy.
 *
 * Enumene er `varchar` og ikke Postgres-enums, i motsetning til `frequencyenum`. Det er
 * bevisst og speiler v1: eierskaps- og statusverdiene her endres oftere enn frekvensene, og
 * en ekte enum krever `ALTER TYPE ... ADD VALUE` utenfor transaksjon for hver nye verdi.
 * Gyldige verdier håndheves i Zod-skjemaet (`src/lib/parkering.ts`) i stedet.
 */

export const parkingSpots = pgTable("parking_spots", {
  id: varchar("id").primaryKey(),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  number: varchar("number").notNull(),
  areaLabel: varchar("area_label"),
  /** «felles» = styret kan disponere og leie ut. «privat» = tilhører en andel. */
  ownershipType: varchar("ownership_type").notNull().default("felles"),
  spotType: varchar("spot_type").notNull().default("standard"),
  status: varchar("status").notNull().default("ledig"),
  holderName: varchar("holder_name"),
  unitLabel: varchar("unit_label"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Aktiv leieavtale for en felleseid plass. Sletting = avslutning av leieforholdet. */
export const parkingLeases = pgTable("parking_leases", {
  id: varchar("id").primaryKey(),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  /** Unik: én plass kan ha høyst én aktiv avtale. Databasen håndhever det, ikke bare koden. */
  spotId: varchar("spot_id")
    .notNull()
    .unique()
    .references(() => parkingSpots.id, { onDelete: "cascade" }),
  tenantName: varchar("tenant_name").notNull(),
  pricePerMonth: integer("price_per_month").notNull(),
  startDate: date("start_date"),
  /** NULL = løpende avtale. */
  endDate: date("end_date"),
  noticePeriodMonths: integer("notice_period_months"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Venteliste for felleseide plasser som ikke er ledige nå. */
export const parkingWaitlist = pgTable("parking_waitlist", {
  id: varchar("id").primaryKey(),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: varchar("name").notNull(),
  requestedType: varchar("requested_type").notNull().default("standard"),
  requestedAt: date("requested_at").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ParkingSpot = typeof parkingSpots.$inferSelect;
export type ParkingLease = typeof parkingLeases.$inferSelect;
export type ParkingWaitlistEntry = typeof parkingWaitlist.$inferSelect;
