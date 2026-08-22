import { boolean, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

/**
 * Kundens webhooks — «varsle styrets Teams-kanal når …». Ny i v2, ingen v1-fasit.
 *
 * URL-en oppgis av kunden og postes til fra VÅR server — derfor valideres den mot interne
 * adresser i `webhookInn` (lib/webhooks.ts), så feltet ikke kan brukes til å sondere
 * Docker-nettet. `events` er en JSON-liste med nøkler fra `lib/webhookvalg.ts`.
 *
 * `lastOk`/`lastError` er ren driftsstatus for innstillingssiden: en webhook som feiler gjør
 * det stille (et varsel som ikke kom frem skal aldri velte handlingen), og uten disse feltene
 * hadde kunden ikke hatt noe sted å SE at kanalen deres er død.
 */
export const orgWebhooks = pgTable("org_webhooks", {
  id: varchar("id").primaryKey(),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  /** Kundens eget navn på målet — «Styrets Teams-kanal». */
  name: varchar("name").notNull(),
  /** `teams` | `slack` | `discord` | `generisk` — se WEBHOOK_TYPER. */
  targetType: varchar("target_type").notNull(),
  url: text("url").notNull(),
  /** JSON-liste med hendelsesnøkler fra WEBHOOK_HENDELSER. */
  events: text("events").notNull(),
  active: boolean("active").notNull().default(true),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  lastOk: boolean("last_ok"),
  /** Kort feiltekst («HTTP 404», «tidsavbrudd») — null når siste sending gikk bra. */
  lastError: varchar("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type OrgWebhook = typeof orgWebhooks.$inferSelect;
