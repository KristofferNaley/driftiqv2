/**
 * Unloc-koblingen per org og de digitale nøklene per leverandør. Designnotatet er
 * `docs/unloc.md`; HTTP-laget er `unloc.ts`.
 *
 * Hemmeligheten (client secret) ligger kryptert i `unloc_settings` (`lib/kryptering.ts`)
 * og dekrypteres bare her, i det øyeblikket et kall skal gjøres. `hentKobling()` returnerer
 * den aldri.
 *
 * ## Hva som er sannhet hvor
 *
 * Unloc eier nøkkelen: om den åpner døra, avgjøres der. `vendor_unloc_keys` er styrets
 * bokføring av utdelingen — hvem ga, til hvem, hvorfor — og et speil av tilstanden som
 * friskes opp når fanen åpnes. Feil fra Unloc ved oppfrisking RETURNERES (`feil`-feltet),
 * så lista vises med sist kjente tilstand i stedet for å velte.
 *
 * ## Én fjernbar pakke
 *
 * Den eneste koblingen inn i resten av appen er `antallAktiveNokler()`, som
 * `slettLeverandor` bruker for å nekte sletting av en leverandør med levende nøkler — en
 * nøkkel i Unloc som DriftIQ ikke lenger vet om, er nettopp det integrasjonen skal hindre.
 */

import { and, asc, desc, eq, isNull, notInArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "../db/client";
import { unlocSettings, vendorUnlocKeys } from "../db/schema/unloc";
import { vendors } from "../db/schema/vendors";
import type { Aktor } from "./aktor";
import { ApiFeil, ikkeFunnet, ugyldig } from "./api";
import { loggHendelse } from "./hendelser";
import { dekrypter, krypter, krypteringErKonfigurert } from "./kryptering";
import {
  type Credentials,
  UnlocFeil,
  type UnlocNokkelState,
  glemTokens,
  gyldigProsjektToken,
  hentLaaser as hentLaaserFraUnloc,
  hentNokler as hentNoklerFraUnloc,
  hentProsjekt,
  hentRessurser,
  opprettNokkel,
  tilE164,
  tilbakekallNokkel,
} from "./unloc";

const MODUL = "leverandorer" as const;

/** Tilstander der nøkkelen ikke lenger kan åpne noe — de friskes ikke opp og teller ikke som aktive. */
export const FERDIGE_TILSTANDER: readonly UnlocNokkelState[] = ["expired", "revoked", "error"];

export const koblingInn = z.object({
  clientId: z.string().trim().min(8, "Client id ser for kort ut"),
  clientSecret: z.string().trim().min(8, "Client secret ser for kort ut"),
  /** Prosjektet nøklene skal opprettes i. Velges automatisk hvis credentials bare når ett. */
  projectId: z.string().trim().nullish(),
});

export const nokkelInn = z.object({
  lockId: z.string().trim().min(1, "Velg en lås"),
  phone: z.string().trim().min(8, "Mobilnummer mangler"),
  holderName: z.string().trim().min(1, "Hvem hos leverandøren skal ha nøkkelen?").max(120),
  /** ISO-tidspunkt. Tom = nå. */
  startAt: z.string().datetime({ offset: true }).nullish(),
  /** ISO-tidspunkt. Tom = uten utløp. */
  endAt: z.string().datetime({ offset: true }).nullish(),
  note: z.string().trim().max(500).nullish(),
});

/**
 * Feil fra Unloc blir `ApiFeil` med Unlocs melding — ikke «Noe gikk galt».
 *
 * ALDRI 502 eller 504 her: Cloudflare-tunnelen bytter ut de statusene fra origin med sin
 * egen HTML-feilside, og da finner klienten ingen `detail` og viser «Noe gikk galt» (skjedde
 * 05.09.2026). Avviste forespørsler (4xx fra Unloc) er 400 hos oss; alt annet 503.
 */
function tilApiFeil(e: unknown): never {
  if (e instanceof UnlocFeil) throw new ApiFeil(e.status >= 400 && e.status < 500 ? 400 : 503, e.message);
  if (e instanceof Error && e.name === "TimeoutError") throw new ApiFeil(503, "Unloc svarte ikke i tide");
  throw e;
}

// ---------------------------------------------------------------------------------------
// Koblingen
// ---------------------------------------------------------------------------------------

/** Status uten hemmeligheter — det Integrasjoner-fanen viser. */
export async function hentKobling(db: Db, orgId: string) {
  const r = await db.select().from(unlocSettings).where(eq(unlocSettings.orgId, orgId)).limit(1);
  const k = r[0];
  const aktive = k ? await antallAktiveNokler(db, orgId) : 0;
  return {
    konfigurert: { kryptering: krypteringErKonfigurert() },
    kobling: k
      ? {
          clientId: k.clientId,
          projectId: k.projectId,
          projectName: k.projectName,
          connectedBy: k.connectedBy,
          createdAt: k.createdAt,
          lastError: k.lastError,
          lastCheckedAt: k.lastCheckedAt,
        }
      : null,
    nokler: { aktive },
  };
}

async function hentRad(db: Db, orgId: string) {
  const r = await db.select().from(unlocSettings).where(eq(unlocSettings.orgId, orgId)).limit(1);
  if (!r[0]) throw ikkeFunnet("Unloc-kobling");
  return r[0];
}

async function credentialsFor(db: Db, orgId: string) {
  const k = await hentRad(db, orgId);
  const c: Credentials = { clientId: k.clientId, clientSecret: dekrypter(k.clientSecretEnc) };
  return { rad: k, c, token: async () => gyldigProsjektToken(c, k.projectId) };
}

async function noterFeil(db: Db, orgId: string, id: string, feil: string | null, naa = new Date()) {
  await db
    .update(unlocSettings)
    .set({ lastError: feil ? feil.slice(0, 500) : null, lastCheckedAt: naa })
    .where(and(eq(unlocSettings.id, id), eq(unlocSettings.orgId, orgId)));
}

/**
 * Kobler til: credentials verifiseres mot Unloc (ressursoppdagelse), prosjektet velges —
 * automatisk når credentials bare når ett med `project.admin` — og navnet hentes så
 * fanen kan vise hva som er koblet. Ingenting lagres før Unloc har svart ja.
 */
export async function kobleTil(db: Db, orgId: string, av: Aktor, data: z.infer<typeof koblingInn>) {
  if (!krypteringErKonfigurert()) throw new ApiFeil(503, "Koblingen er ikke satt opp på serveren (mangler nøkkel for kryptering).");
  const c: Credentials = { clientId: data.clientId, clientSecret: data.clientSecret };
  let prosjekter: string[];
  try {
    const r = await hentRessurser(c);
    prosjekter = r.resources.projects.filter((p) => p.scope === "project.admin").map((p) => p.projectId);
  } catch (e) {
    tilApiFeil(e);
  }
  if (prosjekter.length === 0) throw ugyldig("Credentials når ingen prosjekter i Unloc med project.admin-tilgang.");

  const valgt: string | null = data.projectId ? (prosjekter.includes(data.projectId) ? data.projectId : null) : prosjekter.length === 1 ? prosjekter[0]! : null;
  if (data.projectId && !valgt) throw ugyldig("Credentials når ikke det oppgitte prosjektet.");
  let prosjektNavn: string;
  let unlocOrgId: string | null = null;
  try {
    if (!valgt) {
      const navn = await Promise.all(
        prosjekter.slice(0, 10).map(async (id) => {
          const t = await gyldigProsjektToken(c, id);
          const p = await hentProsjekt(t, id);
          return `${p.name} (${id})`;
        }),
      );
      throw ugyldig(`Velg hvilket prosjekt nøklene skal opprettes i: ${navn.join(", ")}`);
    }
    const t = await gyldigProsjektToken(c, valgt);
    const p = await hentProsjekt(t, valgt);
    prosjektNavn = p.name;
    unlocOrgId = p.organizationId ?? null;
  } catch (e) {
    tilApiFeil(e);
  }

  const felter = {
    clientId: c.clientId,
    clientSecretEnc: krypter(c.clientSecret),
    projectId: valgt,
    projectName: prosjektNavn,
    unlocOrganizationId: unlocOrgId,
    connectedBy: av.navn,
    connectedByUserId: av.brukerId,
    lastError: null,
    lastCheckedAt: new Date(),
  };
  const finnes = await db.select({ id: unlocSettings.id, clientId: unlocSettings.clientId }).from(unlocSettings).where(eq(unlocSettings.orgId, orgId)).limit(1);
  if (finnes[0]) {
    glemTokens(finnes[0].clientId);
    await db.update(unlocSettings).set(felter).where(and(eq(unlocSettings.id, finnes[0].id), eq(unlocSettings.orgId, orgId)));
  } else {
    await db.insert(unlocSettings).values({ id: randomUUID(), orgId, ...felter });
  }
  await loggHendelse(db, orgId, av, {
    modul: MODUL, entitet: "unloc", entitetId: null,
    hendelse: `Koblet digitale nøkler til Unloc-prosjektet «${prosjektNavn}»`,
  });
  return hentKobling(db, orgId);
}

/**
 * Frakobling fjerner credentials, men lar nøkkelradene stå: de er styrets historikk over
 * hvem som har fått nøkkel, og nøklene i Unloc påvirkes ikke av at DriftIQ glemmer
 * credentials. Aktive nøkler bør kalles tilbake FØR frakobling — UI-et sier fra.
 */
export async function kobleFra(db: Db, orgId: string, av: Aktor) {
  const k = await hentRad(db, orgId);
  const aktive = await antallAktiveNokler(db, orgId);
  glemTokens(k.clientId);
  await db.delete(unlocSettings).where(and(eq(unlocSettings.id, k.id), eq(unlocSettings.orgId, orgId)));
  await loggHendelse(db, orgId, av, {
    modul: MODUL, entitet: "unloc", entitetId: null,
    hendelse: `Koblet fra Unloc-prosjektet «${k.projectName}»${aktive > 0 ? ` — ${aktive} utdelt${aktive === 1 ? "" : "e"} nøkkel${aktive === 1 ? "" : "er"} sto fortsatt aktiv${aktive === 1 ? "" : "e"} i Unloc` : ""}`,
  });
}

/** Låsene i prosjektet — live fra Unloc, til nedtrekket i «Del ut nøkkel». */
export async function hentLaaser(db: Db, orgId: string) {
  const { rad, token } = await credentialsFor(db, orgId);
  try {
    const laaser = await hentLaaserFraUnloc(await token(), rad.projectId);
    await noterFeil(db, orgId, rad.id, null);
    return laaser.map((l) => ({
      id: l.id,
      name: l.name,
      vendor: l.vendor ?? null,
      floor: l.address?.floor ?? null,
      battery: l.batteryStatus?.batteryLevel ?? null,
    }));
  } catch (e) {
    await noterFeil(db, orgId, rad.id, e instanceof Error ? e.message : String(e));
    tilApiFeil(e);
  }
}

// ---------------------------------------------------------------------------------------
// Nøkler per leverandør
// ---------------------------------------------------------------------------------------

async function krevLeverandor(db: Db, orgId: string, vendorId: string) {
  const r = await db
    .select({ id: vendors.id, name: vendors.name })
    .from(vendors)
    .where(and(eq(vendors.id, vendorId), eq(vendors.orgId, orgId)))
    .limit(1);
  if (!r[0]) throw ikkeFunnet("Leverandør");
  return r[0];
}

/** Nøkler som fortsatt kan åpne noe (eller er på vei til å kunne det). Org-vid uten vendorId. */
export async function antallAktiveNokler(db: Db, orgId: string, vendorId?: string): Promise<number> {
  const betingelser = [
    eq(vendorUnlocKeys.orgId, orgId),
    isNull(vendorUnlocKeys.revokedAt),
    notInArray(vendorUnlocKeys.state, [...FERDIGE_TILSTANDER]),
  ];
  if (vendorId) betingelser.push(eq(vendorUnlocKeys.vendorId, vendorId));
  const r = await db.select({ id: vendorUnlocKeys.id }).from(vendorUnlocKeys).where(and(...betingelser));
  return r.length;
}

function tilVisning(r: typeof vendorUnlocKeys.$inferSelect) {
  return {
    id: r.id,
    unlocKeyId: r.unlocKeyId,
    lockId: r.lockId,
    lockName: r.lockName,
    phone: r.phone,
    holderName: r.holderName,
    startAt: r.startAt,
    endAt: r.endAt,
    state: r.state as UnlocNokkelState,
    stateCheckedAt: r.stateCheckedAt,
    note: r.note,
    issuedBy: r.issuedBy,
    issuedByUserId: r.issuedByUserId,
    revokedBy: r.revokedBy,
    revokedAt: r.revokedAt,
    createdAt: r.createdAt,
  };
}

/**
 * Leverandørens nøkler, nyeste først. Med kobling friskes tilstanden på de levende
 * nøklene opp fra Unloc i ett kall (hele prosjektets nøkler — et sameie har titalls, ikke
 * tusener). Svikter Unloc, kommer lista likevel, med `feil` satt og sist kjente tilstand.
 */
export async function hentNoklerForLeverandor(db: Db, orgId: string, vendorId: string, opts: { frisk?: boolean; naa?: Date } = {}) {
  await krevLeverandor(db, orgId, vendorId);
  const kobling = await db.select().from(unlocSettings).where(eq(unlocSettings.orgId, orgId)).limit(1);
  const koblet = kobling.length > 0;
  let feil: string | null = null;

  if (koblet && opts.frisk !== false) {
    const rad = kobling[0]!;
    const levende = await db
      .select()
      .from(vendorUnlocKeys)
      .where(and(eq(vendorUnlocKeys.orgId, orgId), eq(vendorUnlocKeys.vendorId, vendorId), notInArray(vendorUnlocKeys.state, [...FERDIGE_TILSTANDER])));
    if (levende.length > 0) {
      try {
        const c: Credentials = { clientId: rad.clientId, clientSecret: dekrypter(rad.clientSecretEnc) };
        const token = await gyldigProsjektToken(c, rad.projectId);
        const hosUnloc = new Map((await hentNoklerFraUnloc(token, rad.projectId)).map((k) => [k.id, k]));
        const naa = opts.naa ?? new Date();
        for (const l of levende) {
          const u = hosUnloc.get(l.unlocKeyId);
          // Borte hos Unloc = kalt tilbake der (i Control Center) — speil det som «revoked».
          const nyState: UnlocNokkelState = u?.state ?? "revoked";
          await db
            .update(vendorUnlocKeys)
            .set({
              state: nyState,
              stateCheckedAt: naa,
              endAt: u?.end ? new Date(u.end) : u ? null : l.endAt,
              ...(nyState === "revoked" && !l.revokedAt ? { revokedAt: naa, revokedBy: l.revokedBy ?? "Unloc (utenfor DriftIQ)" } : {}),
            })
            .where(and(eq(vendorUnlocKeys.id, l.id), eq(vendorUnlocKeys.orgId, orgId)));
        }
        await noterFeil(db, orgId, rad.id, null, naa);
      } catch (e) {
        feil = e instanceof Error ? e.message : String(e);
        await noterFeil(db, orgId, rad.id, feil);
      }
    }
  }

  const rader = await db
    .select()
    .from(vendorUnlocKeys)
    .where(and(eq(vendorUnlocKeys.orgId, orgId), eq(vendorUnlocKeys.vendorId, vendorId)))
    .orderBy(desc(vendorUnlocKeys.createdAt), asc(vendorUnlocKeys.lockName));
  return { koblet, feil, nokler: rader.map(tilVisning) };
}

/**
 * Deler ut en nøkkel: låsen slås opp (navnet lagres som snapshot), nøkkelen opprettes i
 * Unloc, raden skrives med utdeler, og hendelsen logges — i samme transaksjon.
 */
export async function delUtNokkel(db: Db, orgId: string, vendorId: string, av: Aktor, data: z.infer<typeof nokkelInn>, naa = new Date()) {
  const lev = await krevLeverandor(db, orgId, vendorId);
  const phone = tilE164(data.phone);
  if (!phone) throw ugyldig("Mobilnummeret må være et gyldig nummer, f.eks. 912 34 567 eller +47 912 34 567.");
  const startAt = data.startAt ? new Date(data.startAt) : naa;
  const endAt = data.endAt ? new Date(data.endAt) : null;
  if (endAt && endAt.getTime() <= startAt.getTime()) throw ugyldig("Utløp må være etter starttidspunktet.");
  if (endAt && endAt.getTime() <= naa.getTime()) throw ugyldig("Utløpet er allerede passert.");

  const { rad, token } = await credentialsFor(db, orgId);
  let laasNavn: string;
  let opprettet: { id: string; state: UnlocNokkelState };
  try {
    const t = await token();
    const laas = (await hentLaaserFraUnloc(t, rad.projectId)).find((l) => l.id === data.lockId);
    if (!laas) throw ugyldig("Låsen finnes ikke i Unloc-prosjektet lenger — last lista på nytt.");
    laasNavn = laas.name;
    // Start i fortid avvises av Unloc (> 1 time); «nå» sendes som null = servertid.
    opprettet = await opprettNokkel(t, rad.projectId, {
      lockId: laas.id,
      appUserId: phone,
      start: data.startAt && startAt.getTime() > naa.getTime() ? startAt.toISOString() : null,
      end: endAt ? endAt.toISOString() : null,
      metadata: { driftiq_vendor: lev.name.slice(0, 256), driftiq_vendor_id: vendorId, driftiq_issued_by: av.navn.slice(0, 256) },
    });
    await noterFeil(db, orgId, rad.id, null, naa);
  } catch (e) {
    if (!(e instanceof ApiFeil)) await noterFeil(db, orgId, rad.id, e instanceof Error ? e.message : String(e), naa);
    tilApiFeil(e);
  }

  const id = randomUUID();
  await db.insert(vendorUnlocKeys).values({
    id,
    orgId,
    vendorId,
    unlocKeyId: opprettet.id,
    lockId: data.lockId,
    lockName: laasNavn,
    phone,
    holderName: data.holderName,
    startAt,
    endAt,
    state: opprettet.state,
    stateCheckedAt: naa,
    note: data.note ?? null,
    issuedBy: av.navn,
    issuedByUserId: av.brukerId,
  });
  await loggHendelse(db, orgId, av, {
    modul: MODUL, entitet: "unloc_nokkel", entitetId: id,
    hendelse: `Delte ut digital nøkkel til «${laasNavn}» for ${data.holderName} (${lev.name})${endAt ? `, gyldig til ${endAt.toISOString().slice(0, 10)}` : ", uten utløp"}${data.note ? ` — ${data.note}` : ""}`,
  });
  const r = await db.select().from(vendorUnlocKeys).where(and(eq(vendorUnlocKeys.id, id), eq(vendorUnlocKeys.orgId, orgId))).limit(1);
  return tilVisning(r[0]!);
}

/**
 * Kaller tilbake: Unloc først, så raden. 404 (borte) og 409 («May not revoke expired keys»)
 * fra Unloc betyr at nøkkelen allerede er ubrukelig der — da oppdateres raden likevel,
 * ellers hadde den stått «aktiv» for alltid.
 */
export async function tilbakekall(db: Db, orgId: string, vendorId: string, id: string, av: Aktor, naa = new Date()) {
  const lev = await krevLeverandor(db, orgId, vendorId);
  const r = await db
    .select()
    .from(vendorUnlocKeys)
    .where(and(eq(vendorUnlocKeys.id, id), eq(vendorUnlocKeys.orgId, orgId), eq(vendorUnlocKeys.vendorId, vendorId)))
    .limit(1);
  const n = r[0];
  if (!n) throw ikkeFunnet("Nøkkel");
  if (n.revokedAt || n.state === "revoked") throw ugyldig("Nøkkelen er allerede kalt tilbake.");

  const { rad, token } = await credentialsFor(db, orgId);
  try {
    await tilbakekallNokkel(await token(), rad.projectId, n.unlocKeyId);
    await noterFeil(db, orgId, rad.id, null, naa);
  } catch (e) {
    // 404 = borte hos Unloc; 409 «May not revoke expired keys» = allerede ubrukelig. Begge:
    // raden skal ut av «aktiv» uansett.
    if (!(e instanceof UnlocFeil && (e.status === 404 || e.status === 409))) {
      await noterFeil(db, orgId, rad.id, e instanceof Error ? e.message : String(e), naa);
      tilApiFeil(e);
    }
  }
  await db
    .update(vendorUnlocKeys)
    .set({ state: "revoked", stateCheckedAt: naa, revokedAt: naa, revokedBy: av.navn, revokedByUserId: av.brukerId })
    .where(and(eq(vendorUnlocKeys.id, n.id), eq(vendorUnlocKeys.orgId, orgId)));
  await loggHendelse(db, orgId, av, {
    modul: MODUL, entitet: "unloc_nokkel", entitetId: n.id,
    hendelse: `Kalte tilbake digital nøkkel til «${n.lockName}» fra ${n.holderName} (${lev.name})`,
  });
}
