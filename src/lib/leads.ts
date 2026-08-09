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
  /** Honningkrukka. Skal ALLTID være tom fra et menneske. Se kommentaren øverst. */
  felle: z.string().max(200).optional(),

  /* Fra Enhetsregisteret, når besøkende har valgt laget sitt i søket. */
  orgNr: z.string().trim().max(20).nullish(),
  orgForm: z.string().trim().max(120).nullish(),
  kommune: z.string().trim().max(120).nullish(),
  adresse: z.string().trim().max(300).nullish(),
  postnummer: z.string().trim().max(20).nullish(),
  poststed: z.string().trim().max(120).nullish(),
  brregEpost: z.string().trim().max(200).nullish(),
  brregTelefon: z.string().trim().max(60).nullish(),
  brregNettsted: z.string().trim().max(300).nullish(),
  brregRaa: z.string().max(20000).nullish(),
});

export async function registrerLead(db: Db, data: z.infer<typeof leadInn>) {
  if (data.felle && data.felle.trim() !== "") {
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
      orgNr: data.orgNr ?? null,
      orgForm: data.orgForm ?? null,
      kommune: data.kommune ?? null,
      adresse: data.adresse ?? null,
      postnummer: data.postnummer ?? null,
      poststed: data.poststed ?? null,
      brregEpost: data.brregEpost ?? null,
      brregTelefon: data.brregTelefon ?? null,
      nettsted: data.brregNettsted ?? null,
      brregRaa: data.brregRaa ?? null,
    })
    .returning();

  return { lagret: true as const, lead: rad! };
}

export async function hentLeads(db: Db) {
  return db.select().from(leads).orderBy(desc(leads.createdAt)).limit(200);
}
