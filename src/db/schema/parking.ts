import { boolean, date, integer, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
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
  /** «felles» = styret kan disponere og leie ut. «tinglyst»/«seksjon» = tilhører boenheten. */
  ownershipType: varchar("ownership_type").notNull().default("felles"),
  /** «standard» | «hc» | «mc» | «gjest». Lading er IKKE en type lenger — se `hasCharger`. */
  spotType: varchar("spot_type").notNull().default("standard"),
  status: varchar("status").notNull().default("ledig"),
  holderName: varchar("holder_name"),
  unitLabel: varchar("unit_label"),
  /**
   * Ladepunkt på plassen. Egen kolonne og ikke en plasstype: en HC-plass kan ha lader, og
   * v1s «lading»-type gjorde det umulig å si begge deler. Migrasjon 0045 konverterer.
   */
  hasCharger: boolean("has_charger").notNull().default(false),
  /** Fritekst om ladepunktet — «Easee, garasjeanlegg U1». Integrasjon er ikke bygget. */
  chargerLabel: varchar("charger_label"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Leieavtale for en felleseid plass. Avslutning setter `endedAt` — raden SLETTES ikke:
 * hvem som leide hvilken plass når er dokumentasjon styret trenger i tildelingssaker.
 * «Én aktiv avtale per plass» håndheves derfor i koden (`endedAt IS NULL`), ikke lenger
 * av en unik nøkkel — historikken gjør at samme plass forekommer flere ganger.
 */
export const parkingLeases = pgTable("parking_leases", {
  id: varchar("id").primaryKey(),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  spotId: varchar("spot_id")
    .notNull()
    .references(() => parkingSpots.id, { onDelete: "cascade" }),
  tenantName: varchar("tenant_name").notNull(),
  pricePerMonth: integer("price_per_month").notNull(),
  startDate: date("start_date"),
  /** NULL = løpende avtale. */
  endDate: date("end_date"),
  noticePeriodMonths: integer("notice_period_months"),
  /** «forbruk» | «inkludert» | «fast» — hva avtalen sier om strøm til lading. */
  powerBilling: varchar("power_billing"),
  /** Satt = avtalen er avsluttet. */
  endedAt: timestamp("ended_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Venteliste for felleseide plasser som ikke er ledige nå. */
export const parkingWaitlist = pgTable("parking_waitlist", {
  id: varchar("id").primaryKey(),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: varchar("name").notNull(),
  /** Leiligheten («H0301») — rekkefølge og tildeling skal kunne begrunnes per enhet. */
  unitLabel: varchar("unit_label"),
  requestedType: varchar("requested_type").notNull().default("standard"),
  requestedAt: date("requested_at").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ParkingSpot = typeof parkingSpots.$inferSelect;
export type ParkingLease = typeof parkingLeases.$inferSelect;
export type ParkingWaitlistEntry = typeof parkingWaitlist.$inferSelect;
