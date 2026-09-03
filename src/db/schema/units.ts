import { integer, numeric, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

/**
 * Fysisk enhet i bygget — leilighet/andel/seksjon (BL-109).
 *
 * Registeret inneholder BARE fysiske fakta: andelsnummer, leilighetsnummer, oppgang, etasje,
 * areal. **Ingen eiere, ingen beboere, ingen kontaktopplysninger.** Det er ikke en
 * forglemmelse som skal fylles ut senere — det er hele grunnlaget for at registeret ikke
 * konkurrerer med forretningsførerens andelsregister, ikke må holdes à jour ved eierskifte,
 * og ikke tilfører personopplysninger som ville truffet vedlegg A i databehandleravtalen.
 * Legges eiernavn inn, faller alle tre bort samtidig.
 *
 * **Avklart 03.09.2026 (økonomimodulen):** eiere finnes nå likevel — men i EGEN tabell,
 * `unit_owners` (`schema/okonomi.ts`), med historikk og databehandleravtale, ikke som
 * kolonner her. Denne tabellen er fortsatt bare fysiske fakta pluss sameiebrøken, som er
 * en egenskap ved seksjonen (tinglyst), ikke ved eieren.
 *
 * `andelsnr` er tekst og ikke heltall: sameier bruker seksjonsnummer, og noen har
 * bokstavsuffiks. Nullbar fordi sameier uten andelsnummer identifiserer enheten med
 * oppgang + leilighetsnummer i stedet.
 *
 * `type` skiller boliger fra fellesarealer (bossrom, takterrasse, utleielokale …).
 * Fellesarealer bor i samme register fordi avvik peker hit via `unitId` — bossrommet får
 * dermed samme avvikshistorikk over år som en leilighet, uten en parallell tabell.
 *
 * Feltnavnene er norske her, i strid med den vanlige regelen om engelske kolonnenavn. Det er
 * arvet fra v1 og beholdes med vilje: å døpe om dem ville gjort migreringen til en
 * oversettelse i stedet for en kopi, uten at noen ser forskjellen.
 */
export const units = pgTable("units", {
  id: varchar("id").primaryKey(),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id),
  /** «bolig» | «fellesareal» */
  type: varchar("type").notNull().default("bolig"),
  /** Fellesarealets navn, f.eks. «Bossrom oppgang B». Nummerfeltene står tomme da. */
  navn: varchar("navn"),
  beskrivelse: text("beskrivelse"),
  andelsnr: varchar("andelsnr"),
  /** Matrikkelformat, f.eks. H0101. */
  leilighetsnr: varchar("leilighetsnr"),
  oppgang: varchar("oppgang"),
  etasje: varchar("etasje"),
  arealM2: numeric("areal_m2", { precision: 10, scale: 2 }),
  /**
   * Sameiebrøken, teller/nevner (f.eks. 125/1000). Grunnlaget for fordeling av
   * felleskostnader — se `lib/okonomiregler.ts`. Begge NULL når brøken ikke er registrert;
   * en seksjon uten brøk får ingen beregnet sats, og det vises som en mangel, ikke som 0.
   */
  brokTeller: integer("brok_teller"),
  brokNevner: integer("brok_nevner"),
  /**
   * Bløt sletting. En enhet med avvikshistorikk skal aldri kunne forsvinne med kaskade — da
   * mistes nettopp det som gjør registeret verdt å ha: at gjentakende fukt i samme leilighet
   * er synlig over år. Arkiverte enheter beholder også andelsnummeret sitt, så det ikke kan
   * gjenbrukes på en annen leilighet mens gamle avvik peker hit.
   */
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Unit = typeof units.$inferSelect;
