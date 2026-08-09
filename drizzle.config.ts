import { defineConfig } from "drizzle-kit";

/**
 * Migrasjonene genereres av drizzle-kit og sjekkes inn under `drizzle/`.
 *
 * Dette er den ene tingen v2 gjør vesentlig annerledes enn v1, som hadde hånd-rullet SQL i
 * `_apply_migrations()`. Den formen krevde at hver setning var idempotent og tålte å kjøres
 * ved hver oppstart — det virket, men det fantes ingen historikk og ingen vei tilbake.
 * Generert og versjonert SQL gir begge deler. RLS-policyene settes fortsatt programmatisk
 * (se `src/db/rls/setup.ts`), fordi de skal kunne endres for alle tabeller samtidig.
 */
export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
  // Bevisst norsk: bryter-navnene havner i loggen når en migrasjon dropper noe.
  verbose: true,
  strict: true,
});
