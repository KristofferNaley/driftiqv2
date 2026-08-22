/**
 * Hendelsesloggen — skrivesiden og lesesiden for `audit_events`.
 *
 * ## Skrives i samme transaksjon som handlingen
 *
 * `loggHendelse` kalles fra lib-funksjonene med samme `db` som handlingen selv, akkurat som
 * `skrivLogg` i `lib/avvik.ts`. Feiler innsettingen, ruller hele handlingen tilbake — det er
 * med vilje: en handling uten logglinje og en logglinje uten handling er begge løgn.
 * (Kontrasten er `auth_events`-skrivingen i innloggingen, som feiler stille — et loggkall
 * skal aldri stoppe en innlogging. Revisjonsdata og driftsdata har ulike kontrakter.)
 *
 * ## Hva som logges
 *
 * Mutasjoner med revisjonsverdi: tilgangsendringer, sletting, eksport, nøkler, tildelinger.
 * Aldri lesing — det blåser opp tabellen og personvernbelastningen uten tilsvarende verdi.
 * `event`-teksten er norsk fritekst i fortid («Endret tilgangsnivå til visning»), samme valg
 * som `deviation_logs`: protokollen skal leses av mennesker, maskinfiltrering bæres av
 * `module`/`entity`-kolonnene.
 */

import { and, desc, eq, lt, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Db } from "../db/client";
import { auditEvents } from "../db/schema/hendelser";
import { users } from "../db/schema/users";
import type { Aktor } from "./aktor";
import type { ModulNokkel } from "./moduler";

/** Modulnøklene pluss «org» — bruker- og org-administrasjon hører ikke til noen modul. */
export type HendelseModul = ModulNokkel | "org";

/**
 * Oppbevaringstid. En policybeslutning, ikke miljøkonfig — derfor konstant og ikke env.
 * Tre år fordi loggen også er HMS-dokumentasjon; personvernet setter den øvre grensen.
 */
export const HENDELSER_OPPBEVARING_DAGER = 3 * 365;

export async function loggHendelse(
  db: Db,
  orgId: string,
  av: Aktor,
  h: { modul: HendelseModul; entitet: string; entitetId?: string | null; hendelse: string },
) {
  await db.insert(auditEvents).values({
    id: randomUUID(),
    orgId,
    actorName: av.navn,
    actorUserId: av.brukerId,
    module: h.modul,
    entity: h.entitet,
    entityId: h.entitetId ?? null,
    event: h.hendelse,
  });
}

export const HENDELSER_SIDESTORRELSE = 50;

/**
 * Leser loggen, nyeste først. Aktørens NÅVÆRENDE navn vinner når raden har en id —
 * snapshotet i `actor_name` er reserven for anonyme rader, samme regel som i driftsloggen.
 */
export async function hentHendelser(
  db: Db,
  orgId: string,
  filter: { modul?: string; aktorUserId?: string; side?: number } = {},
) {
  const side = Math.max(0, filter.side ?? 0);
  const betingelser = [eq(auditEvents.orgId, orgId)];
  if (filter.modul) betingelser.push(eq(auditEvents.module, filter.modul));
  if (filter.aktorUserId) betingelser.push(eq(auditEvents.actorUserId, filter.aktorUserId));

  const [rader, [antall]] = await Promise.all([
    db
      .select({ hendelse: auditEvents, aktorNavn: users.name })
      .from(auditEvents)
      .leftJoin(users, eq(users.id, auditEvents.actorUserId))
      .where(and(...betingelser))
      .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
      .limit(HENDELSER_SIDESTORRELSE)
      .offset(side * HENDELSER_SIDESTORRELSE),
    db
      .select({ antall: sql<number>`count(*)::int` })
      .from(auditEvents)
      .where(and(...betingelser)),
  ]);

  return {
    hendelser: rader.map((r) => ({
      ...r.hendelse,
      actorName: r.aktorNavn ?? r.hendelse.actorName,
    })),
    // count(*) er bigint og kommer som streng fra node-postgres uten ::int-casten over.
    antall: antall!.antall,
    side,
    sideStorrelse: HENDELSER_SIDESTORRELSE,
  };
}

/** Ryddejobben. Kjøres uten org-kontekst (bakgrunnsjobb) — sletter på tvers av alle org-er. */
export async function slettGamleHendelser(db: Db, naa: Date): Promise<number> {
  const grense = new Date(naa.getTime() - HENDELSER_OPPBEVARING_DAGER * 24 * 60 * 60 * 1000);
  const slettet = await db
    .delete(auditEvents)
    .where(lt(auditEvents.occurredAt, grense))
    .returning({ id: auditEvents.id });
  return slettet.length;
}
