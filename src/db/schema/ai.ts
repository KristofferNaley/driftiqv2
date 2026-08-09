import { date, integer, pgTable, text, timestamp, unique, varchar } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { users } from "./users";

/**
 * En lagret samtale med AI-rådgiveren.
 *
 * **PRIVAT PER BRUKER.** Samtaler er scopet på både `orgId` OG `userId`, og alle spørringer
 * må filtrere på begge — `orgId` alene ville latt et styremedlem lese kollegenes samtaler.
 *
 * Plattformadmin i support-modus treffer heller ikke andres samtaler: `userId`-filteret er
 * absolutt. Det er med vilje — support skal ikke lese styrets private spørsmål.
 */
export const aiConversations = pgTable("ai_conversations", {
  id: varchar("id").primaryKey(),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  userId: varchar("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: varchar("title").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Én tur i en samtale. Teksten kopieres inn slik den ble vist — endres et avvik eller en
 * kontrakt senere, skal ikke det gamle svaret endre seg.
 */
export const aiMessages = pgTable("ai_messages", {
  id: varchar("id").primaryKey(),
  conversationId: varchar("conversation_id")
    .notNull()
    .references(() => aiConversations.id, { onDelete: "cascade" }),
  /** `bruker` | `assistent`. */
  role: varchar("role").notNull(),
  content: text("content").notNull(),
  /** JSON-liste med kilder, kun på assistent-turer. */
  sources: text("sources"),
  /**
   * Hvilken modell som faktisk svarte. Lagres per melding og utledes ikke fra dagens
   * konstant — bytter vi modell senere, skal en gammel logg fortsatt vise sannheten.
   */
  model: varchar("model"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Aggregert AI-forbruk per organisasjon per dag.
 *
 * Egen tabell, ikke utledet fra samtalene, av to grunner:
 *   1. Samtaler slettes etter 6 måneder — statistikken skal overleve slettingen.
 *   2. Plattformadmin har ikke lesetilgang til samtaler. Denne tabellen inneholder kun
 *      tellere og tokenforbruk, aldri spørsmål, svar eller bruker-id.
 *
 * Derfor kan den også beholdes lenger: den er ikke personopplysninger.
 */
export const aiUsageDaily = pgTable(
  "ai_usage_daily",
  {
    id: varchar("id").primaryKey(),
    orgId: varchar("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    /** Antall besvarte spørsmål. */
    questions: integer("questions").notNull().default(0),
    /** Kall mot Anthropic — verktøyloopen gir flere per spørsmål. */
    apiCalls: integer("api_calls").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("uq_ai_usage_org_dato").on(t.orgId, t.date)],
);

export type AiConversation = typeof aiConversations.$inferSelect;
export type AiMessage = typeof aiMessages.$inferSelect;
export type AiUsageDaily = typeof aiUsageDaily.$inferSelect;
