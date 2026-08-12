import { pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

/**
 * Henvendelser fra landingssiden.
 *
 * Står i `UNNTATT` i rls/tables.ts: en lead har ingen `org_id` — den er nettopp noen som
 * ENNÅ ikke er kunde. RLS har ingenting å filtrere på, og tabellen er kun for plattformadmin.
 *
 * Skjemaet er offentlig og uautentisert. Beskyttelsen er en honningkrukke (se `leads.ts`),
 * ikke en innlogging — å kreve konto for å ta kontakt ville vært absurd.
 */
export const leads = pgTable("leads", {
  id: varchar("id").primaryKey(),
  name: varchar("name").notNull(),
  email: varchar("email").notNull(),
  phone: varchar("phone"),
  /** Borettslaget eller sameiet de sitter i. */
  company: varchar("company"),
  message: text("message"),

  /* ── Fra Enhetsregisteret ──
   * Fylles inn når besøkende velger laget sitt i søket. Lagres på leaden og ikke bare vist
   * i skjemaet: velger de laget og lar et felt stå tomt, er opplysningen fortsatt verdt å
   * ha når vi følger opp. */
  orgNr: varchar("org_nr"),
  orgForm: varchar("org_form"),
  kommune: varchar("kommune"),
  adresse: varchar("adresse"),
  postnummer: varchar("postnummer"),
  poststed: varchar("poststed"),
  /** Registerets kontaktopplysninger — ikke besøkendes egne. Holdes atskilt med vilje. */
  brregEpost: varchar("brreg_epost"),
  brregTelefon: varchar("brreg_telefon"),
  nettsted: varchar("nettsted"),
  /**
   * Hele registersvaret, ordrett.
   *
   * Registeret returnerer mer enn vi har felter for (næringskode, stiftelsesdato,
   * sektorkode, historiske navn). Hvilke som viser seg nyttige vet vi ikke ennå, og enheten
   * kan ha endret seg innen noen spør. Kaster vi dem her, er de borte for godt.
   */
  brregRaa: text("brreg_raa"),
  /**
   * ny | kontaktet | kvalifisert | avslatt | konvertert — samme løp som v1, så migrerte
   * leads beholder statusen sin. `konvertert` settes KUN av «Lag kunde», aldri for hånd.
   */
  status: varchar("status").notNull().default("ny"),
  /**
   * Kunden leaden ble til. SET NULL som i v1: slettes kunden, blir leaden liggende som
   * historikk — men konvertert-statusen beholdes, så den ikke ser ubehandlet ut.
   */
  convertedOrgId: varchar("converted_org_id").references(() => organizations.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Lead = typeof leads.$inferSelect;
