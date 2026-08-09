/**
 * Better Auths egne tabeller.
 *
 * Alle fire står i `UNNTATT` i rls/tables.ts: de er global identitet, og sesjonsoppslag skjer
 * FØR org er kjent. En RLS-policy her ville gjort innlogging umulig — nøyaktig samme grunn som
 * at `users` sto utenfor i v1.
 *
 * Selve brukeren ligger IKKE her. Better Auth peker på den eksisterende `users`-tabellen
 * (se ../../lib/auth.ts), slik at det finnes én brukertabell og ikke to som må holdes i synk.
 * Det er den viktigste enkeltbeslutningen i auth-porten: to brukertabeller ville betydd at
 * `role`, `active` og medlemskapene måtte speiles ved hver skriving.
 */

import { boolean, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { users } from "./users";

export const session = pgTable("session", {
  id: varchar("id").primaryKey(),
  userId: varchar("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * Innloggingsmetode. `password` holder bcrypt-hashen — samme format som v1s
 * `users.password_hash`, med vilje: så lenge begge systemene lever, skal et passord byttet i
 * v2 fortsatt virke i v1, og omvendt. Se hashing-konfigurasjonen i lib/auth.ts.
 */
export const account = pgTable("account", {
  id: varchar("id").primaryKey(),
  userId: varchar("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  password: text("password"),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** Engangstokens: e-postverifisering, glemt passord, magiske lenker. */
export const verification = pgTable("verification", {
  id: varchar("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** Nøkkelpar for JWT-pluginen. Se lib/auth.ts om hvorfor JWKS og ikke delt hemmelighet. */
export const jwks = pgTable("jwks", {
  id: varchar("id").primaryKey(),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
