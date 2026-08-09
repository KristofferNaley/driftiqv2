/**
 * Henvendelser fra landingssiden.
 *
 * ## Offentlig og uautentisert
 *
 * Å kreve konto for å ta kontakt ville vært absurd, så skjemaet er åpent. Beskyttelsen mot
 * søppel er en **honningkrukke**: et felt som er skjult for mennesker, men som skjemaroboter
 * fyller ut fordi de leser HTML-en og ikke CSS-en. Er det utfylt, later vi som alt gikk bra
 * og lagrer ingenting — en robot som får en feilmelding, prøver på nytt med en annen taktikk.
 *
 * Bevisst ikke CAPTCHA: det ville sendt besøkendes data til en tredjepart, og lagt en
 * hindring foran nettopp den som vil snakke med oss.
 */

import { desc } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "../db/client";
import { leads } from "../db/schema/leads";

export const leadInn = z.object({
  name: z.string().trim().min(1, "Navn må fylles ut"),
  email: z.string().trim().toLowerCase().email("Ugyldig e-postadresse"),
  phone: z.string().trim().max(40).nullish(),
  company: z.string().trim().max(200).nullish(),
  message: z.string().trim().max(4000).nullish(),
  /** Honningkrukka. Skal ALLTID være tom fra et menneske. */
  nettsted: z.string().max(200).optional(),
});

export async function registrerLead(db: Db, data: z.infer<typeof leadInn>) {
  if (data.nettsted && data.nettsted.trim() !== "") {
    // Later som det gikk bra. Se kommentaren øverst.
    return { lagret: false as const };
  }

  const [rad] = await db
    .insert(leads)
    .values({
      id: randomUUID(),
      name: data.name,
      email: data.email,
      phone: data.phone ?? null,
      company: data.company ?? null,
      message: data.message ?? null,
    })
    .returning();

  return { lagret: true as const, lead: rad! };
}

export async function hentLeads(db: Db) {
  return db.select().from(leads).orderBy(desc(leads.createdAt)).limit(200);
}
