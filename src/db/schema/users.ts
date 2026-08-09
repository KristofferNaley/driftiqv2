import { boolean, pgEnum, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

/**
 * PLATTFORMAKSEN — hvem brukeren er i DriftIQ, uavhengig av organisasjon.
 * Ikke det samme som hva de får lov til inne i en kunde; det er `accessLevelEnum`.
 */
export const roleEnum = pgEnum("roleenum", [
  "superadmin",
  "admin",
  "member",
  "vendor",
  "kontoansvarlig",
]);

/**
 * TILGANGSAKSEN — hva en bruker kan gjøre inne i ÉN organisasjon. Tre nivåer, stigende.
 *
 * - `orgadmin`: alt i driftsmodulene + Brukere, Innstillinger, Fakturering.
 * - `redigering`: opprette, endre og kvittere ut i driftsmodulene. Ser ikke kontosidene.
 * - `visning`: ser alt innhold og kan melde avvik, men endrer ingenting.
 */
export const accessLevelEnum = pgEnum("accesslevelenum", ["orgadmin", "redigering", "visning"]);

/**
 * Global bruker. Står i UNNTATT — innlogging skjer før org-kontekst finnes.
 *
 * `passwordHash` er borte fra v1: Better Auth eier legitimasjonen i `account`-tabellen.
 * Kolonnen gjenoppstår ikke her selv om migreringen leser den — den leses én gang, av
 * migreringsskriptet, og skrives inn i Better Auths eget skjema.
 */
export const users = pgTable("users", {
  id: varchar("id").primaryKey(),
  /** Arv fra før multi-org, nullbar. Reell tilgang styres av userOrgMemberships. */
  orgId: varchar("org_id").references(() => organizations.id),
  name: varchar("name").notNull(),
  email: varchar("email").notNull().unique(),
  phone: varchar("phone"),
  role: roleEnum("role").notNull().default("member"),
  active: boolean("active").notNull().default(true),
  /** Sist vellykkede innlogging — ETT felt, ikke en logg (BL-121). */
  lastLoginAt: timestamp("last_login_at"),

  // --- Påkrevd av Better Auth. Biblioteket peker på DENNE tabellen, ikke en egen `user`. ---
  emailVerified: boolean("email_verified").notNull().default(false),
  /**
   * Profilbilde-URL. v1 lagret sti + filnavn i `avatar_path`/`avatar_name` og lekket aldri
   * stien til frontend — filnavnet var selve tilgangsnøkkelen. Den modellen kommer tilbake
   * når filhåndteringen portes; feltet her er Better Auths, ikke erstatningen.
   */
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** Selve tilgangstabellen. Står i UNNTATT — org-velgeren må lese medlemskap på tvers. */
export const userOrgMemberships = pgTable("user_org_memberships", {
  id: varchar("id").primaryKey(),
  userId: varchar("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  role: accessLevelEnum("role").notNull().default("visning"),
  /** Ren beskrivelse — styrer ingenting. Nivået over er det eneste som gjelder. */
  title: varchar("title"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type User = typeof users.$inferSelect;
export type UserOrgMembership = typeof userOrgMemberships.$inferSelect;
