/**
 * Kundedetaljen i plattformpanelet — organisasjonen, modulene, abonnementet og onboardingen.
 *
 * Skilt fra `plattform.ts` fordi den fila ble stedet der alt havnet. Skillet går ved hva som
 * gjelder ÉN kunde (her) og hva som gjelder plattformen på tvers (der): dashbord, kundeliste,
 * support-sesjoner og plattformbrukere.
 *
 * Samme regel gjelder likevel: hver rute MÅ gå gjennom
 * `plattformRute({ nivaa: "plattformadmin" })`. Det er ingen RLS her, så gaten står i ruta.
 *
 * ## Dette gir fortsatt ikke innsyn i kundedata
 *
 * Onboardingen TELLER kundens rader — hvor mange leverandører, kontrakter og dokumenter som
 * finnes — men leser aldri innholdet. Et tall svarer på «er de i gang?», ikke på hva som
 * står i dokumentene. For selve innholdet kreves en support-sesjon.
 */

import { and, count, desc, eq, isNotNull, ne, or } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "../db/client";
import { bbl } from "../db/schema/bbl";
import { organizations } from "../db/schema/organizations";
import { platformContracts } from "../db/schema/platform";
import { annualEvents } from "../db/schema/arshjul";
import { contracts } from "../db/schema/kontrakter";
import { documents } from "../db/schema/dokumenter";
import { routines } from "../db/schema/rutiner";
import { units } from "../db/schema/units";
import { userOrgMemberships, users } from "../db/schema/users";
import { vendors } from "../db/schema/vendors";
import { ikkeFunnet } from "./api";
import { ALLE_MODULER, modulErAktivert, type ModulNokkel } from "./moduler";
import { grunnpakke } from "./prisregler";
import { hentPrismodell } from "./prismodell";

// ---------------------------------------------------------------------------------------
// Organisasjonen
// ---------------------------------------------------------------------------------------

export const kundeEndring = z.object({
  name: z.string().trim().min(1, "Navn må fylles ut").optional(),
  orgNr: z.string().trim().nullish(),
  orgForm: z.string().trim().nullish(),
  municipality: z.string().trim().nullish(),
  unitCount: z.number().int().min(0).nullish(),
  phone: z.string().trim().nullish(),
  contactEmail: z.string().trim().nullish(),
  website: z.string().trim().nullish(),
  hasEmployees: z.boolean().optional(),
  active: z.boolean().optional(),
  /** Demo-/testkunde — holdes utenfor statistikken. */
  demo: z.boolean().optional(),
  /** Lagringskvote i BYTES. Skjemaet regner om fra GB — se kommentaren på feltet. */
  storageQuota: z.number().int().min(0).nullish(),
});

export const tilknytningEndring = z.object({
  affiliationType: z.enum(["frittstaende", "tilknyttet"]).nullish(),
  bblId: z.string().nullish(),
  managerType: z.enum(["selvadministrert", "bbl", "ekstern"]).nullish(),
  managerBblId: z.string().nullish(),
  managerName: z.string().trim().nullish(),
  managerOrgNr: z.string().trim().nullish(),
});

async function krevOrg(db: Db, orgId: string) {
  const rader = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  const org = rader[0];
  if (!org) throw ikkeFunnet("Organisasjon");
  return org;
}

export async function endreKunde(db: Db, orgId: string, data: z.infer<typeof kundeEndring>) {
  await krevOrg(db, orgId);
  const felter: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    // Tom streng fra et skjemafelt betyr «ikke utfylt», ikke «lagre en tom streng» — ellers
    // blir `—` i visningen til et usynlig blankt felt.
    felter[k] = typeof v === "string" && v.trim() === "" ? null : v;
  }
  if (Object.keys(felter).length > 0) {
    await db.update(organizations).set(felter).where(eq(organizations.id, orgId));
  }
  return krevOrg(db, orgId);
}

/**
 * Tilknytning og forretningsfører.
 *
 * Rydder opp i feltene som ikke gjelder lenger: bytter man fra «ekstern» til «bbl», skal det
 * gamle byrånavnet bort — ellers blir det stående i databasen og dukker opp igjen neste gang
 * noen bytter tilbake. Samme vei andre veien.
 */
export async function settTilknytning(
  db: Db,
  orgId: string,
  data: z.infer<typeof tilknytningEndring>,
) {
  await krevOrg(db, orgId);

  const felter: Record<string, unknown> = {
    affiliationType: data.affiliationType ?? null,
    managerType: data.managerType ?? null,
    // Et frittstående lag har ikke noe boligbyggelag å være tilknyttet.
    bblId: data.affiliationType === "tilknyttet" ? (data.bblId ?? null) : null,
    managerBblId: data.managerType === "bbl" ? (data.managerBblId ?? null) : null,
    managerName: data.managerType === "ekstern" ? (data.managerName ?? null) : null,
    managerOrgNr: data.managerType === "ekstern" ? (data.managerOrgNr ?? null) : null,
  };

  await db.update(organizations).set(felter).where(eq(organizations.id, orgId));
  return krevOrg(db, orgId);
}

// ---------------------------------------------------------------------------------------
// Moduler
// ---------------------------------------------------------------------------------------

export const modulEndring = z.object({
  moduler: z.array(z.enum(ALLE_MODULER)),
});

/**
 * Hvilke moduler kunden har.
 *
 * Styres KUN herfra. Kundens egne innstillinger har ingen modulbryter — en kontoadmin som
 * kunne skru på Internkontroll selv, ville fått en betalt modul gratis.
 *
 * Lagres som en eksplisitt liste. Fra det øyeblikket lista finnes, er den fasit: en modul
 * som senere blir på-som-standard slås ikke automatisk på for denne kunden. Det er med
 * vilje — plattformadmin har tatt et valg, og det skal ikke overstyres av en kodeendring.
 */
export async function settModuler(db: Db, orgId: string, moduler: ModulNokkel[]) {
  await krevOrg(db, orgId);
  await db
    .update(organizations)
    .set({ enabledModules: JSON.stringify([...new Set(moduler)]) })
    .where(eq(organizations.id, orgId));
  return krevOrg(db, orgId);
}

// ---------------------------------------------------------------------------------------
// Abonnement
// ---------------------------------------------------------------------------------------

export const abonnementInn = z.object({
  moduler: z.array(z.object({ key: z.string(), price: z.number().int().min(0) })).default([]),
  discountPercent: z.number().int().min(0).max(100).default(0),
  startDate: z.string().nullish(),
  endDate: z.string().nullish(),
  notes: z.string().nullish(),
});

/**
 * Oppretter eller oppdaterer abonnementet.
 *
 * `baseFee` regnes ut på nytt ved hver lagring og lagres som SNAPSHOT. Endrer vi satsene i
 * prismodellen i morgen, skal ikke inngåtte avtaler endre seg av seg selv — men den som
 * faktisk redigerer kontrakten skal få dagens satser. Derfor på skriving, ikke på lesing.
 */
export async function settAbonnement(
  db: Db,
  orgId: string,
  data: z.infer<typeof abonnementInn>,
) {
  const org = await krevOrg(db, orgId);
  const modell = await hentPrismodell(db);
  const baseFee = grunnpakke(org.unitCount, modell.gulvpris, modell.trinn);

  const felter = {
    baseFee,
    modules: JSON.stringify(data.moduler),
    discountPercent: data.discountPercent,
    startDate: data.startDate || null,
    endDate: data.endDate || null,
    notes: data.notes ?? null,
  };

  const finnes = await db
    .select({ id: platformContracts.id })
    .from(platformContracts)
    .where(eq(platformContracts.orgId, orgId))
    .orderBy(desc(platformContracts.createdAt))
    .limit(1);

  if (finnes[0]) {
    await db.update(platformContracts).set(felter).where(eq(platformContracts.id, finnes[0].id));
  } else {
    await db.insert(platformContracts).values({ id: randomUUID(), orgId, ...felter });
  }
  return hentAbonnement(db, orgId);
}

export async function hentAbonnement(db: Db, orgId: string) {
  const rader = await db
    .select()
    .from(platformContracts)
    .where(eq(platformContracts.orgId, orgId))
    .orderBy(desc(platformContracts.createdAt))
    .limit(1);
  const k = rader[0];
  if (!k) return null;

  let moduler: Array<{ key: string; price: number }> = [];
  try {
    const tolket = JSON.parse(k.modules ?? "[]");
    if (Array.isArray(tolket)) moduler = tolket;
  } catch {
    // Ødelagt JSON ⇒ ingen moduler. Kontrakten skal fortsatt kunne åpnes og rettes.
  }
  return { ...k, moduler };
}

export async function slettAbonnement(db: Db, orgId: string) {
  await db.delete(platformContracts).where(eq(platformContracts.orgId, orgId));
}

// ---------------------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------------------

type Punkt = { nokkel: string; etikett: string; ok: boolean; detalj?: string | null };

const tall = (n: number, entall: string, flertall: string) =>
  n === 0 ? null : `${n} ${n === 1 ? entall : flertall}`;

/** Tellingene punktene regnes fra — samme form enten de kommer per kunde eller gruppert. */
export type OnboardingTellinger = {
  enheter: number;
  brukere: number;
  leverandorer: number;
  kontrakter: number;
  arshjul: number;
  rutiner: number;
  dokumenter: number;
  abonnement: number;
};

/**
 * De ti punktene som REN funksjon — kundelista (gruppert per org) og kundedetaljen (én org)
 * skal regne identisk, og v1 lærte oss hva kopier gjør: de driver.
 */
export function onboardingPunkter(
  org: { unitCount: number | null; buildingInfo: string | null },
  t: OnboardingTellinger,
): Punkt[] {
  return [
    { nokkel: "abonnement", etikett: "Abonnement registrert", ok: t.abonnement > 0 },
    {
      nokkel: "andeler",
      etikett: "Antall andeler satt",
      ok: Boolean(org.unitCount),
      detalj: tall(org.unitCount ?? 0, "andel", "andeler"),
    },
    {
      nokkel: "enheter",
      etikett: "Enhetsregisteret fylt",
      ok: t.enheter > 0,
      detalj: tall(t.enheter, "enhet", "enheter"),
    },
    {
      nokkel: "om_bygget",
      etikett: "«Om bygget» utfylt",
      ok: Boolean(org.buildingInfo && org.buildingInfo.trim() && org.buildingInfo !== "{}"),
    },
    {
      // Én bruker er kontoen vi opprettet for dem. Styret er først inne når flere har
      // tilgang — det er da systemet slutter å være én persons ansvar.
      nokkel: "styret",
      etikett: "Styret lagt inn (minst 2 brukere)",
      ok: t.brukere >= 2,
      detalj: tall(t.brukere, "bruker", "brukere"),
    },
    {
      nokkel: "leverandorer",
      etikett: "Leverandører registrert",
      ok: t.leverandorer > 0,
      detalj: tall(t.leverandorer, "leverandør", "leverandører"),
    },
    {
      nokkel: "kontrakter",
      etikett: "Kontrakter lagt inn",
      ok: t.kontrakter > 0,
      detalj: tall(t.kontrakter, "kontrakt", "kontrakter"),
    },
    {
      nokkel: "arshjul",
      etikett: "Årshjul i bruk",
      ok: t.arshjul > 0,
      detalj: tall(t.arshjul, "hendelse", "hendelser"),
    },
    {
      nokkel: "rutiner",
      etikett: "Rutiner opprettet",
      ok: t.rutiner > 0,
      detalj: tall(t.rutiner, "rutine", "rutiner"),
    },
    {
      nokkel: "dokumenter",
      etikett: "Dokumenter i arkivet",
      ok: t.dokumenter > 0,
      detalj: tall(t.dokumenter, "dokument", "dokumenter"),
    },
  ];
}

export function onboardingProsent(punkter: Punkt[]): number {
  return Math.round((100 * punkter.filter((p) => p.ok).length) / punkter.length);
}

/**
 * Hvor langt kunden er kommet med å ta systemet i bruk.
 *
 * Ti punkter, hvert av dem et JA/NEI på om noe finnes. Poenget er å se hvem som har fått en
 * konto, men aldri kommet i gang — de ringer ikke og sier fra.
 */
export async function hentOnboarding(db: Db, orgId: string) {
  const org = await krevOrg(db, orgId);

  const [
    enheter,
    brukere,
    leverandorer,
    kontrakter,
    arshjul,
    rutiner,
    dokumenter,
    abonnement,
  ] = await Promise.all([
    db
      .select({ n: count() })
      .from(units)
      .where(and(eq(units.orgId, orgId), ne(units.type, "fellesareal"))),
    /**
     * Plattformbrukere teller IKKE som kundens brukere.
     *
     * De får medlemskap i hver org for å kunne yte support — de er DriftIQ-ansatte, ikke
     * kundens styre. Uten filteret telte hver kunde én bruker for mye, og «styret lagt inn»
     * kunne bli grønt av en org med bare én ekte bruker. Det var en reell feil i v1.
     */
    db
      .select({ n: count() })
      .from(userOrgMemberships)
      .innerJoin(users, eq(users.id, userOrgMemberships.userId))
      .where(
        and(
          eq(userOrgMemberships.orgId, orgId),
          ne(users.role, "superadmin"),
          ne(users.role, "kontoansvarlig"),
        ),
      ),
    db
      .select({ n: count() })
      .from(vendors)
      .where(and(eq(vendors.orgId, orgId), eq(vendors.active, true))),
    db.select({ n: count() }).from(contracts).where(eq(contracts.orgId, orgId)),
    db.select({ n: count() }).from(annualEvents).where(eq(annualEvents.orgId, orgId)),
    db.select({ n: count() }).from(routines).where(eq(routines.orgId, orgId)),
    db.select({ n: count() }).from(documents).where(eq(documents.orgId, orgId)),
    db
      .select({ n: count() })
      .from(platformContracts)
      .where(eq(platformContracts.orgId, orgId)),
  ]);

  const n = (r: Array<{ n: number }>) => r[0]?.n ?? 0;

  const punkter = onboardingPunkter(org, {
    enheter: n(enheter),
    brukere: n(brukere),
    leverandorer: n(leverandorer),
    kontrakter: n(kontrakter),
    arshjul: n(arshjul),
    rutiner: n(rutiner),
    dokumenter: n(dokumenter),
    abonnement: n(abonnement),
  });

  return { prosent: onboardingProsent(punkter), punkter };
}

// ---------------------------------------------------------------------------------------
// Samlet detalj
// ---------------------------------------------------------------------------------------

/** Navnene på lagene kunden er knyttet til. To oppslag, ikke to joins — enklere å lese. */
async function bblNavn(db: Db, ider: Array<string | null>) {
  const unike = [...new Set(ider.filter((i): i is string => Boolean(i)))];
  if (unike.length === 0) return new Map<string, string>();
  const rader = await db.select({ id: bbl.id, name: bbl.name }).from(bbl);
  return new Map(rader.filter((r) => unike.includes(r.id)).map((r) => [r.id, r.name]));
}

/** Alt kundedetaljsiden trenger, i ett kall. */
export async function hentDetalj(db: Db, orgId: string) {
  const org = await krevOrg(db, orgId);
  const [abonnement, onboarding, navn, modell] = await Promise.all([
    hentAbonnement(db, orgId),
    hentOnboarding(db, orgId),
    bblNavn(db, [org.bblId, org.managerBblId]),
    hentPrismodell(db),
  ]);

  return {
    org: {
      ...org,
      bblNavn: org.bblId ? (navn.get(org.bblId) ?? null) : null,
      managerBblNavn: org.managerBblId ? (navn.get(org.managerBblId) ?? null) : null,
    },
    moduler: ALLE_MODULER.filter((n) => modulErAktivert(org.enabledModules, n)),
    abonnement,
    onboarding,
    /**
     * Prismodellen følger med fordi fakturaskjemaet regner ut totalen MENS man skriver.
     * Uten den måtte skjemaet hentet satsene i et eget kall og vise et tomt tall imens.
     */
    prismodell: {
      gulvpris: modell.gulvpris,
      trinn: modell.trinn,
      modulpriser: modell.modulpriser,
    },
    /** Beregnet på nytt her, så skjemaet viser dagens sats og ikke kontraktens snapshot. */
    grunnpakkeNaa: grunnpakke(org.unitCount, modell.gulvpris, modell.trinn),
  };
}

/** Alle boligbyggelag, til nedtrekkene i tilknytningsskjemaet. */
export async function hentBblValg(db: Db) {
  return db
    .select({ id: bbl.id, name: bbl.name, active: bbl.active })
    .from(bbl)
    .where(or(eq(bbl.active, true), isNotNull(bbl.successorId)))
    .orderBy(bbl.name);
}
