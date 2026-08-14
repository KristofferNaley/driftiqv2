/**
 * Gjenoppretter innholdet i de to standard-HMS-malene («Standard vernerunde» og
 * «Standard risikovurdering») og setter dem som standard for sin type.
 *
 *   docker run --rm --network edge --env-file .env -v "$PWD:/app" -w /app node:22-alpine \
 *     npx tsx scripts/gjenopprett-standardmaler.ts
 *
 * Bakgrunn (14.08.2026): testsuiten delte base med appen og hadde to uskopede skrivinger —
 * et `UPDATE hms_template_items` uten WHERE satte alle punkttekster til «Helt annet punkt»,
 * og én-standard-regelen i maltestene flyttet `is_default` bort fra de ekte malene.
 * Testene er skopet nå, og dette skriptet er fasiten for malinnholdet: risikospørsmålene
 * er PDF-en fra Håsteinsgate 9 ordrett, vernerundepunktene er skrevet for å være
 * OBSERVERBARE på en befaring (ikke rutinesjekker).
 *
 * Idempotent: sletter malens punkter og setter inn disse. Kategoriene (nøkkel/etikett/
 * rekkefølge) røres ikke — de peker malene allerede på.
 */

import { randomUUID } from "node:crypto";
import { Pool } from "pg";

/** Punkttekster per kategorinøkkel, i visningsrekkefølge. */
type Malinnhold = Record<string, string[]>;

const VERNERUNDE: Malinnhold = {
  brannvern: [
    "Rømningsveier og nødtrapper er frie for lagring og hindringer",
    "Branndører lukker seg selv — ingen står oppkilt",
    "Markeringsskilt og nødlys lyser der de skal",
    "Håndslokkere henger på plass og har gyldig kontrollmerke",
    "Brannslanger er tilgjengelige og uten synlige skader",
    "Branninstruks er oppslått og leselig i alle oppganger",
  ],
  el_sikkerhet: [
    "Sikringsskap i fellesareal er lukket og fritt for lagring",
    "Ingen synlige skader på ledninger, stikkontakter eller armaturer i fellesareal",
    "Belysning virker i alle fellesarealer, også kjeller og loft",
    "Ingen faste skjøteledninger eller provisoriske elektriske opplegg i fellesareal",
  ],
  teknisk_utstyr: [
    "Heisen går normalt og viser ingen feilmeldinger",
    "Varmtvannsbereder og teknisk rom er uten lekkasje og feilmeldinger",
    "Ventilasjon eller felles avtrekk går, og rister og filtre er rene",
    "Maskinene i fellesvaskeriet er uten synlige feil, og rommet er ryddig",
    "Ladepunkter for elbil er uten synlige skader på kabel, kontakt og feste",
  ],
  avfall_skadedyr: [
    "Avfallsrom og -beholdere er ryddige og uten overfylling",
    "Ingen avfall eller gjenstander lagres utenfor beholderne",
    "Ingen tegn til skadedyr (ekskrementer, gnagemerker, reir)",
    "Området rundt avfallsbeholderne er rent og fremkommelig",
  ],
  brannfarlig_vare: [
    "Ingen bensin, gass eller annen brannfarlig vare oppbevares i boder eller fellesareal",
    "Ingen brennbart materiale er lagret inntil fasade eller under trapper",
    "Garasjeanlegget er fritt for drivstoffkanner og gassbeholdere",
  ],
  vann_lekkasje: [
    "Ingen tegn til fukt eller lekkasje i kjeller (misfarging, lukt, saltutslag)",
    "Stoppekraner er tilgjengelige, merket og uten drypp",
    "Sluk i fellesareal er rene og tar unna vann",
    "Takrenner og nedløp er frie for løv og fører vannet bort fra bygget",
  ],
  personsikkerhet: [
    "Trapper, trinn og rekkverk er solide og uten løse fester",
    "Utebelysning ved innganger og langs gangveier virker",
    "Dekket på gangveier og i bakgård er uten snublefeller (løse heller, hull, kanter)",
    "Lekeapparater er hele, uten skarpe kanter, og fallunderlaget er i orden",
    "Rutiner for snømåking, strøing og fjerning av istapper fungerer",
  ],
};

/** Håsteinsgate 9s risikovurdering (13.08.2026) ordrett — spørsmål 1.1–6.6. */
const RISIKOVURDERING: Malinnhold = {
  brannvern: [
    "Hvor stor er risikoen for branntilløp i leilighetene?",
    "Hvor stor er risikoen for branntilløp i fellesarealer?",
    "Hvor stor er sjansen for blokkering/hindringer i rømningsveiene?",
    "Hvor stor er risikoen for at brannalarmanlegget ikke fungerer som tiltenkt?",
    "Hvor stor er risikoen for at sprinkleranlegget ikke fungerer som tiltenkt?",
    "Hvor stor er risikoen for at håndslokkere, brannslanger og røykvarslere ikke fungerer som tiltenkt?",
  ],
  el_sikkerhet: [
    "Hvor stor er risikoen for feil i sikringstavle/inntak?",
    "Hvor stor er risikoen for feil og mangler med det elektriske anlegget i fellesarealet?",
    "Hvor stor er sjansen for feil og mangler med det elektriske anlegget i leilighetene?",
  ],
  teknisk_utstyr: [
    "Hvor stor er risikoen for feil eller mangler med det elektriske utstyret som bl.a. vaskemaskiner og tørketromler?",
    "Hvor stor er risikoen for feil med ventilasjonsanlegget?",
    "Hvor stor er risikoen for feil eller mangler med heis?",
  ],
  avfall_skadedyr: [
    "Hvor stor er risikoen for branntilløp i søppelcontainere?",
    "Hvor stor er risikoen for feil ved kildesortering?",
    "Hvor stor er risikoen for manglende renhold og ryddighet rundt avfallsbeholdere?",
    "Hvor stor er risikoen for skadedyr i boligselskapet?",
  ],
  kjemikalier: [
    "Hvor stor er risikoen for feil lagring og oppbevaring av brannfarlig væske og gass?",
  ],
  personsikkerhet: [
    "Hvor stor er risikoen for personskader ved dugnad i boligselskapet?",
    "Hvor stor er risikoen for personskader ved innleid arbeidskraft?",
    "Hvor stor er risikoen for fallulykker?",
    "Hva er risikoen for snøras og fallende istapper på eiendommen som truer sikkerheten?",
    "Hva er risikoen for å bli smittet av legionella?",
    "Hva er risikoen for vannlekkasjer?",
  ],
};

async function gjenopprett(
  pool: Pool,
  templateType: string,
  navn: string,
  innhold: Malinnhold,
): Promise<void> {
  const mal = await pool.query<{ id: string }>(
    "SELECT id FROM hms_templates WHERE template_type = $1 AND name = $2",
    [templateType, navn],
  );
  const malId = mal.rows[0]?.id;
  if (!malId) {
    console.error(`FANT IKKE malen «${navn}» (${templateType}) — hopper over.`);
    return;
  }

  const kategorier = await pool.query<{ id: string; key: string }>(
    "SELECT id, key FROM hms_template_categories WHERE template_id = $1",
    [malId],
  );
  const katAvKey = new Map(kategorier.rows.map((k) => [k.key, k.id]));

  await pool.query(
    "DELETE FROM hms_template_items WHERE category_id IN (SELECT id FROM hms_template_categories WHERE template_id = $1)",
    [malId],
  );

  let antall = 0;
  for (const [key, tekster] of Object.entries(innhold)) {
    const katId = katAvKey.get(key);
    if (!katId) {
      console.error(`  mangler kategorien «${key}» i «${navn}» — punktene der ble ikke lagt inn.`);
      continue;
    }
    for (const [i, text] of tekster.entries()) {
      await pool.query(
        'INSERT INTO hms_template_items (id, category_id, text, "order", created_at) VALUES ($1,$2,$3,$4,now())',
        [randomUUID(), katId, text, i],
      );
      antall++;
    }
  }

  // Én standard per type — de andre malene av typen mister flagget, som i lib/maler.ts.
  await pool.query("UPDATE hms_templates SET is_default = (id = $1) WHERE template_type = $2", [
    malId, templateType,
  ]);
  console.log(`«${navn}»: ${antall} punkter lagt inn, satt som standard for ${templateType}.`);
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await gjenopprett(pool, "vernerunde", "Standard vernerunde", VERNERUNDE);
    await gjenopprett(pool, "risikovurdering", "Standard risikovurdering", RISIKOVURDERING);
  } finally {
    await pool.end();
  }
}

void main();
