/**
 * Plattformens egne tabeller — DriftIQs forhold til kunden, ikke kundens egne data.
 *
 * Begge står i `UNNTATT` i rls/tables.ts. `support_access_log` fordi den er superadmin-only,
 * og `platform_contracts` fordi abonnementssperren leses fra innloggingen, som ikke har
 * org-kontekst — en RLS-policy her ville gjort at sperren aldri fant kontraktene.
 *
 * ## Tidssoner
 *
 * Tidsstemplene her er `timestamptz`, ikke `timestamp` som i v1. v1 lagret naiv UTC og måtte
 * ha en egen `utc_now()` med en kommentar om at man ellers får `TypeError` når en naiv verdi
 * sammenlignes med en tz-bevisst. Den fella er ikke verdt å arve — `timestamptz` gjør
 * sammenligningen entydig, og migreringen fra v1 tolker de gamle verdiene som UTC.
 */

import { date, integer, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { users } from "./users";

/** DriftIQs B2B-kontrakt med en kunde (SaaS-abonnement). */
export const platformContracts = pgTable("platform_contracts", {
  id: varchar("id").primaryKey(),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  annualFee: integer("annual_fee"),
  /** Snapshot av beregnet grunnpakkepris ved lagring. */
  baseFee: integer("base_fee"),
  /** JSON-liste [{"key":"internkontroll","price":12000}, …] — valgte tilleggsmoduler. */
  modules: text("modules"),
  discountPercent: integer("discount_percent").notNull().default(0),
  startDate: date("start_date"),
  /**
   * NULL = løpende kontrakt, som holder tilgangen åpen. Se `abonnementUtlopt()` i
   * lib/tilgang.ts: INGEN registrert kontrakt sperrer heller ingenting — kontrakten er
   * valgfri bokføring, og fraværet av den skal aldri stenge en kunde ute.
   */
  endDate: date("end_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Logg over plattformadmins innsyn i kundedata (support-modus). */
export const supportAccessLog = pgTable("support_access_log", {
  id: varchar("id").primaryKey(),
  /**
   * SET NULL, ikke CASCADE: slettes plattformbrukeren skal loggen bli liggende. En
   * innsynslogg som forsvinner sammen med den som gjorde innsynet, er ingen logg.
   */
  superadminId: varchar("superadmin_id").references(() => users.id, { onDelete: "set null" }),
  /**
   * Navnet kopieres inn når sesjonen starter, så loggen viser HVEM som var inne også etter
   * at brukeren er slettet. Historikk peker aldri på noe som kan endres i ettertid.
   */
  adminName: varchar("admin_name"),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id),
  reason: varchar("reason").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  /**
   * Hard grense for hvor lenge sesjonen gir tilgang. Uten den ville en glemt sesjon gitt
   * innsyn i kundedata i ukevis — sesjonen skal avsluttes manuelt, men det glemmes.
   */
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

export type PlatformContract = typeof platformContracts.$inferSelect;
export type SupportAccessLog = typeof supportAccessLog.$inferSelect;

/**
 * Plattformens prismodell — gulv, trappetrinn og standard modulpriser. Singleton-rad med
 * id `default`; `hentPrismodell()` i lib/prismodell.ts oppretter den ved første oppslag.
 *
 * Ligger her fordi dette er DriftIQs egne tall, ikke kundens. Satsene er forretningsdata en
 * kunde aldri skal se — derfor er hele raden plattformadmin-only, med ett unntak:
 * `hiddenModules`, som kunde-appen må kunne lese for å skjule umodne moduler fra menyen.
 * Det unntaket har sin egen rute, ikke sin egen tabell.
 */
export const pricingConfig = pgTable("pricing_config", {
  id: varchar("id").primaryKey(),
  floorPrice: integer("floor_price").notNull().default(8000),
  /** JSON [{"from":1,"to":50,"rate":280}, …] — degressive trinn. */
  tiers: text("tiers").notNull(),
  /** JSON {"internkontroll":12000, …} — standard årspris per tilleggsmodul. */
  moduleDefaults: text("module_defaults").notNull(),
  /**
   * JSON-liste med modulnøkler som er midlertidig skjult fra kundens sidemeny og fra
   * Prismodell/Fakturering mens de er under utvikling.
   *
   * IKKE det samme som `defaultOff` i modulregisteret: `defaultOff` er en permanent
   * kodenivå-kategorisering («av som standard for nye kunder, men synlig og selgbar»).
   * `hiddenModules` er en midlertidig, databasestyrt bryter («ikke klar for kunder ennå»)
   * som slås av igjen når funksjonen er klar til å selges.
   */
  hiddenModules: text("hidden_modules").notNull().default("[]"),
  /**
   * JSON-liste med e-postadresser som varsles om nye leads og nye innmeldinger. Tom/NULL =
   * fall tilbake på miljøvariabelen, slik det var før lista fantes — da endres ingenting
   * før noen faktisk fyller den ut i panelet.
   *
   * Ligger her fordi dette er plattformens singleton-rad, ikke fordi det har med pris å gjøre.
   */
  leadsNotifyEmails: text("leads_notify_emails"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PricingConfig = typeof pricingConfig.$inferSelect;
