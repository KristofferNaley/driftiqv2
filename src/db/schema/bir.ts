import { date, index, pgTable, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { users } from "./users";

/**
 * BIR — tømmedager for oppslagstavla (Bergen og omegn). Designnotatet er `docs/bir.md`.
 *
 * Fjernbar pakke etter Unloc-mønsteret: disse to tabellene, `lib/bir.ts` (HTTP + tolkning),
 * `lib/birkobling.ts` (logikk), rutene under `/oppslagstavle/bir`, `BirKort.tsx` og
 * jobben «bir-synk». Skjermen leser bare `bir_pickups` — den spør aldri BIR selv.
 */

/**
 * Hvilken BIR-oppføring borettslaget er. Borettslag med fellesløsning er en egen oppføring
 * hos BIR (søkes opp som selskap, ikke adresse), så styret VELGER den — vi gjetter ikke fra
 * adressen.
 */
export const birSettings = pgTable("bir_settings", {
  orgId: varchar("org_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  /** BIRs id (`rId`), en GUID. */
  birId: varchar("bir_id").notNull(),
  birName: varchar("bir_name").notNull(),
  /** Matrikkelen BIR oppgir (kommune.gnr.bnr.fnr.snr) — til visning og feilsøking. */
  realEstateId: varchar("real_estate_id"),
  connectedBy: varchar("connected_by").notNull(),
  connectedByUserId: varchar("connected_by_user_id").references(() => users.id, { onDelete: "set null" }),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  /** Siste feil fra BIR (nettfeil, endret nettside). Tømmes ved neste vellykkede henting. */
  lastError: varchar("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Én tømmedag for én fraksjon. Framtidige rader byttes ut ved hver vellykkede henting. */
export const birPickups = pgTable(
  "bir_pickups",
  {
    id: varchar("id").primaryKey(),
    orgId: varchar("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** Nøkkel fra `lib/avfallsregler.ts` (`rest`, `papir`, …) eller BIRs ikonnavn hvis ukjent. */
    fraction: varchar("fraction").notNull(),
    pickupDate: date("pickup_date").notNull(),
  },
  (t) => [
    index("bir_pickups_org_idx").on(t.orgId),
    uniqueIndex("bir_pickups_unik").on(t.orgId, t.fraction, t.pickupDate),
  ],
);
