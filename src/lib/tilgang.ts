/**
 * Tilgangsgatene — port av `require_org_access`, `require_org_admin`, `require_org_edit` og
 * `har_org_admin` i v1s `backend/app/auth.py`.
 *
 * **Hvert org-endepunkt må kalle en av disse som første linje.** RLS er nettet under, ikke
 * erstatningen: `withOrg()` setter konteksten til den org-en URL-en spør etter, men sier
 * ingenting om at brukeren har lov til å være der. Det er disse funksjonene som avgjør.
 *
 * Plattformadmin har *ikke* automatisk tilgang til kundedata — de må ha en aktiv
 * support-sesjon, og det håndheves her inne.
 *
 * ## Hvorfor gatene tar `db` og ikke åpner sin egen
 *
 * Alle tabellene de leser (`user_org_memberships`, `organizations`, `platform_contracts`,
 * `support_access_log`) står i `UNNTATT` og har ingen RLS-policy. De er derfor synlige for
 * approllen også inne i en `withOrg`-transaksjon, og gaten trenger ikke en egen tilkobling.
 * Én transaksjon per forespørsel er hele poenget med `withOrg`.
 */

import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { organizations } from "../db/schema/organizations";
import { platformContracts, supportAccessLog } from "../db/schema/platform";
import { erPlattformadminRolle } from "./nivaer";
import { userOrgMemberships, type User, type UserOrgMembership } from "../db/schema/users";

/** Maks levetid for en support-sesjon. Etter dette må plattformadmin starte en ny med ny
 *  begrunnelse — som er et nytt innslag i tilgangsloggen kunden kan se. */
export const SUPPORT_SESJON_MAKS_TIMER = 4;

export const ABONNEMENT_UTLOPT_MELDING =
  "Abonnementet er utløpt. Ta kontakt med DriftIQ for å fortsette, " +
  "eller for innsyn i og sletting av dataene deres.";

/** Nivåene som gir skrivetilgang i driftsmodulene. `visning` er bevisst utenfor. */
export const REDIGERENDE_NIVAER = ["orgadmin", "redigering"] as const;

/**
 * Avvist tilgang. Bærer HTTP-statusen med seg slik at rutelaget slipper å gjette — v1s
 * gater kastet `HTTPException` direkte, og meldingene her er ordrett de samme, fordi de
 * vises til brukeren.
 */
export class Tilgangsfeil extends Error {
  constructor(
    readonly status: 401 | 403,
    melding: string,
  ) {
    super(melding);
    this.name = "Tilgangsfeil";
  }
}

export function supportSesjonUtlop(): Date {
  return new Date(Date.now() + SUPPORT_SESJON_MAKS_TIMER * 60 * 60 * 1000);
}

/** Er brukeren plattformadmin? Rolleverdien heter fortsatt `superadmin` i basen — det er kun
 *  ordet vi viser brukeren som er «plattformadmin». */
export function erPlattformadmin(bruker: Pick<User, "role">): boolean {
  return erPlattformadminRolle(bruker.role);
}

export function krevPlattformadmin(bruker: Pick<User, "role">): void {
  if (!erPlattformadmin(bruker)) {
    throw new Tilgangsfeil(403, "Krever plattformadmin-tilgang");
  }
}

/**
 * True når organisasjonen har plattformkontrakter, men alle har passert sin sluttdato.
 *
 * Ingen registrert kontrakt sperrer ingenting — kontrakten er valgfri bokføring, og fraværet
 * av den skal aldri stenge en kunde ute. En kontrakt uten `endDate` er løpende og holder
 * tilgangen åpen.
 */
export async function abonnementUtlopt(db: Db, orgId: string): Promise<boolean> {
  const rader = await db
    .select({ endDate: platformContracts.endDate })
    .from(platformContracts)
    .where(eq(platformContracts.orgId, orgId));

  if (rader.length === 0) return false;
  const iDag = new Date().toISOString().slice(0, 10); // `date`-kolonner leses som 'YYYY-MM-DD'
  return rader.every((r) => r.endDate !== null && r.endDate < iDag);
}

/**
 * Har plattformadminen en support-sesjon som gjelder akkurat nå?
 *
 * Rader med `expiresAt IS NULL` faller ut av seg selv — sammenligningen blir NULL, altså
 * ikke sant. Det er riktig retning å feile i.
 */
export async function harAktivSupportSesjon(
  db: Db,
  orgId: string,
  plattformadminId: string,
): Promise<boolean> {
  const rader = await db
    .select({ id: supportAccessLog.id })
    .from(supportAccessLog)
    .where(
      and(
        eq(supportAccessLog.superadminId, plattformadminId),
        eq(supportAccessLog.orgId, orgId),
        isNull(supportAccessLog.endedAt),
        gt(supportAccessLog.expiresAt, sql`now()`),
      ),
    )
    .limit(1);
  return rader.length > 0;
}

async function medlemskap(
  db: Db,
  orgId: string,
  brukerId: string,
): Promise<UserOrgMembership | undefined> {
  const rader = await db
    .select()
    .from(userOrgMemberships)
    .where(and(eq(userOrgMemberships.userId, brukerId), eq(userOrgMemberships.orgId, orgId)))
    .limit(1);
  return rader[0];
}

async function krevSupportSesjon(db: Db, orgId: string, bruker: User, handling: string) {
  if (!(await harAktivSupportSesjon(db, orgId, bruker.id))) {
    throw new Tilgangsfeil(
      403,
      `Plattformadmin må aktivere support-modus i plattformpanelet for å ${handling} ` +
        "denne organisasjonens data",
    );
  }
}

/**
 * Krever at brukeren er medlem av organisasjonen. Lesetilgang.
 * Plattformadmin må ha aktiv support-sesjon.
 */
export async function krevOrgTilgang(
  db: Db,
  orgId: string,
  bruker: User,
): Promise<UserOrgMembership | null> {
  if (erPlattformadmin(bruker)) {
    await krevSupportSesjon(db, orgId, bruker, "se");
    return null;
  }

  const m = await medlemskap(db, orgId, bruker.id);
  if (!m) throw new Tilgangsfeil(403, "Ingen tilgang til denne organisasjonen");

  // Utløpt abonnement stenger org-en helt — også for sesjoner som allerede er utstedt.
  // Plattformadmin med support-sesjon slipper forbi (grenen over): noen må fortsatt kunne
  // bistå kunden med innsyn og sletting etter at tilgangen deres er stengt.
  if (await abonnementUtlopt(db, orgId)) {
    throw new Tilgangsfeil(403, ABONNEMENT_UTLOPT_MELDING);
  }
  return m;
}

/** Krever `orgadmin`. Kontosidene: Brukere, Innstillinger, Fakturering. */
export async function krevOrgAdmin(db: Db, orgId: string, bruker: User): Promise<void> {
  if (erPlattformadmin(bruker)) {
    await krevSupportSesjon(db, orgId, bruker, "administrere");
    return;
  }

  const m = await medlemskap(db, orgId, bruker.id);
  if (!m || m.role !== "orgadmin") {
    throw new Tilgangsfeil(403, "Krever administratortilgang til denne organisasjonen");
  }
  if (await abonnementUtlopt(db, orgId)) {
    throw new Tilgangsfeil(403, ABONNEMENT_UTLOPT_MELDING);
  }
}

/**
 * Krever redigeringsrett i driftsmodulene (Leverandører, Kontrakter, Oppgaver,
 * Internkontroll, Vedlikeholdsplan, Parkering, Årshjul, Dokumentarkiv).
 *
 * Bredere enn `krevOrgAdmin`: både `orgadmin` og `redigering` slipper til her, mens
 * kontosidene krever `orgadmin`. Tittelen på medlemskapet styrer ingenting — det var en
 * heuristikk i v1 fram til 08.08.2026, og den var usynlig for kunden.
 */
export async function krevOrgRedigering(db: Db, orgId: string, bruker: User): Promise<void> {
  if (erPlattformadmin(bruker)) {
    await krevSupportSesjon(db, orgId, bruker, "administrere");
    return;
  }

  const m = await medlemskap(db, orgId, bruker.id);
  if (!m) throw new Tilgangsfeil(403, "Ingen tilgang til denne organisasjonen");
  if (!REDIGERENDE_NIVAER.includes(m.role as (typeof REDIGERENDE_NIVAER)[number])) {
    throw new Tilgangsfeil(403, "Du har kun visningstilgang i denne organisasjonen");
  }
  if (await abonnementUtlopt(db, orgId)) {
    throw new Tilgangsfeil(403, ABONNEMENT_UTLOPT_MELDING);
  }
}

/**
 * Predikat-varianten av `krevOrgAdmin`, for steder som skal GRADERE hva som er lov i stedet
 * for bare å slippe gjennom eller stenge — f.eks. brukeroppretting, der både orgadmin og
 * redigering slipper til, men bare orgadmin kan dele ut orgadmin videre.
 */
export async function harOrgAdmin(db: Db, orgId: string, bruker: User): Promise<boolean> {
  if (erPlattformadmin(bruker)) return harAktivSupportSesjon(db, orgId, bruker.id);
  const m = await medlemskap(db, orgId, bruker.id);
  return m?.role === "orgadmin";
}

// ---------------------------------------------------------------------------------------
// Sperrene ved innlogging
// ---------------------------------------------------------------------------------------

/**
 * De to sperrene v1 hadde i `/auth/login` utover passord og `active`: deaktivert
 * organisasjon og utløpt abonnement.
 *
 * Ett medlemskap med gyldig abonnement er nok til å slippe inn — org-gatene over sperrer
 * den utløpte org-en. Plattformadmin hoppes over: de har ingen medlemskap å vurdere.
 */
export async function sjekkInnloggingssperrer(db: Db, bruker: User): Promise<void> {
  if (erPlattformadmin(bruker)) return;

  const medlemskaper = await db
    .select({ orgId: userOrgMemberships.orgId, orgAktiv: organizations.active })
    .from(userOrgMemberships)
    .innerJoin(organizations, eq(organizations.id, userOrgMemberships.orgId))
    .where(eq(userOrgMemberships.userId, bruker.id));

  if (medlemskaper.length === 0) return; // ingen medlemskap ennå — ikke en sperre

  const aktive = medlemskaper.filter((m) => m.orgAktiv);
  if (aktive.length === 0) {
    throw new Tilgangsfeil(403, "Organisasjonen er deaktivert");
  }

  const utlopt = await Promise.all(aktive.map((m) => abonnementUtlopt(db, m.orgId)));
  if (utlopt.every(Boolean)) {
    throw new Tilgangsfeil(403, ABONNEMENT_UTLOPT_MELDING);
  }
}
