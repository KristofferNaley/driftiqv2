/**
 * Den periodiske varselsjobben. Port av v1s `notifications.py`.
 *
 * ## Én stor forskjell fra v1: forsinkelsesregelen er DEN SAMME funksjonen
 *
 * v1 måtte skrive `_task_is_overdue` i Python for jobben og `taskErForsinket` i JavaScript
 * for skjermen. De to drev fra hverandre — halvårlig var 182 dager ett sted og 183 et annet,
 * og resultatet var at e-posten varslet om noe annet enn skjermen viste.
 *
 * Her kaller både lista, detaljsiden og denne jobben `erForsinket` i `oppgaveregler.ts`. De
 * KAN ikke svare ulikt, fordi det ikke finnes to svar.
 *
 * ## Skilt fra planleggeren med vilje
 *
 * `kjorVarsler(nå)` tar tidspunktet som argument i stedet for å lese klokka. Uten det måtte
 * en test av mandagssammendraget enten vente til mandag eller manipulere systemtiden.
 */

import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { withoutRls } from "../db/client";
import { contracts } from "../db/schema/kontrakter";
import { organizations } from "../db/schema/organizations";
import { completions, tasks } from "../db/schema/tasks";
import { units } from "../db/schema/units";
import { users as usersTabell } from "../db/schema/users";
import { vendors } from "../db/schema/vendors";
import { sendForsinkedeOppgaver, sendKontrakterUtloper, sendMineForsinkedeOppgaver } from "./epost";
import { erForsinket } from "./oppgaveregler";
import { APP_URL } from "./urler";
import { mottakere, varselPa } from "./varsler";
import { varsleWebhooks, type WebhookMelding } from "./webhooks";

/**
 * Dager igjen som utløser et kontraktvarsel.
 *
 * Milepæler, ikke «under 180 dager»: sistnevnte ville sendt samme e-post hver dag i et halvt
 * år, og styret ville sluttet å lese den.
 */
const KONTRAKT_MILEPAELER = new Set([180, 90, 30, 14, 7]);

const somDato = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Kjører alle periodiske varsler.
 *
 * `naa` er injisert for testbarhet. Returnerer et sammendrag av hva som ble sendt — jobben
 * kjører uten tilskuer, og uten et svar er eneste spor at noen får en e-post.
 */
export async function kjorVarsler(naa: Date = new Date()) {
  const iDag = somDato(naa);
  // 1 = mandag. Ukesammendragene går bare da; daglige sammendrag ville blitt støy.
  const erMandag = naa.getDay() === 1;

  const sendt = { forsinkede: 0, mine: 0, kontrakter: 0, webhooks: 0 };

  /**
   * Webhook-meldingene samles opp INNE i jobbtransaksjonen og sendes ETTER den — sending
   * hører ikke hjemme i en transaksjon (samme regel som `etterCommit` i lib/api.ts), og
   * `varsleWebhooks` åpner sin egen org-kontekst.
   */
  const webhookKo: Array<{ orgId: string; melding: WebhookMelding }> = [];

  // Uten org-kontekst: jobben går på tvers av ALLE kunder, og det er nettopp det
  // «bakgrunnsjobb» er begrunnet med i `db/client.ts`.
  await withoutRls("bakgrunnsjobb", async (db) => {
    const orger = await db
      .select({ id: organizations.id, navn: organizations.name })
      .from(organizations)
      .where(eq(organizations.active, true));

    for (const org of orger) {
      const forsinkede = await forsinkedeOppgaver(db, org.id);

      if (erMandag && forsinkede.length > 0) {
        for (const m of await mottakere(db, org.id, "overdue_task")) {
          await sendForsinkedeOppgaver(org.navn, m.epost, forsinkede);
          sendt.forsinkede++;
        }

        // Personlig påminnelse: én e-post per ansvarlig, med KUN deres egne oppgaver.
        const perAnsvarlig = new Map<string, typeof forsinkede>();
        for (const o of forsinkede) {
          if (!o.ansvarligId) continue;
          const liste = perAnsvarlig.get(o.ansvarligId) ?? [];
          liste.push(o);
          perAnsvarlig.set(o.ansvarligId, liste);
        }
        // Én samlemelding per org — webhooken går til en felles kanal, ikke til personer.
        const viste = forsinkede.slice(0, 10);
        webhookKo.push({
          orgId: org.id,
          melding: {
            hendelse: "oppgave.forsinket",
            tittel:
              forsinkede.length === 1
                ? "1 forsinket oppgave"
                : `${forsinkede.length} forsinkede oppgaver`,
            tekst:
              viste.map((o) => `• ${o.tittel}${o.sted ? ` (${o.sted})` : ""}`).join("\n") +
              (forsinkede.length > viste.length ? `\n… og ${forsinkede.length - viste.length} til` : ""),
            lenke: `${APP_URL}/oppgaver`,
            data: { antall: forsinkede.length },
          },
        });

        for (const [brukerId, mine] of perAnsvarlig) {
          if (!(await varselPa(db, brukerId, org.id, "my_overdue_task"))) continue;
          const bruker = mine[0]!;
          if (!bruker.ansvarligEpost) continue;
          await sendMineForsinkedeOppgaver(
            org.navn,
            bruker.ansvarligEpost,
            bruker.ansvarligNavn ?? "",
            mine,
          );
          sendt.mine++;
        }
      }

      const utloper = await utlopendeKontrakter(db, org.id, iDag);
      if (utloper.length > 0) {
        for (const m of await mottakere(db, org.id, "contract_expiring")) {
          await sendKontrakterUtloper(org.navn, m.epost, utloper);
          sendt.kontrakter++;
        }

        webhookKo.push({
          orgId: org.id,
          melding: {
            hendelse: "kontrakt.utloper",
            tittel:
              utloper.length === 1
                ? "1 avtale nærmer seg utløp"
                : `${utloper.length} avtaler nærmer seg utløp`,
            tekst: utloper
              .map((k) => `• ${k.tittel}${k.leverandor ? ` (${k.leverandor})` : ""} — ${k.dagerIgjen} dager igjen`)
              .join("\n"),
            lenke: `${APP_URL}/kontrakter`,
            data: { antall: utloper.length },
          },
        });
      }
    }
  });

  for (const { orgId, melding } of webhookKo) {
    await varsleWebhooks(orgId, melding);
    sendt.webhooks++;
  }

  return sendt;
}

type Db = Parameters<Parameters<typeof withoutRls>[1]>[0];

/** Forsinkede oppgaver i én org, avgjort av SAMME regel som skjermen bruker. */
async function forsinkedeOppgaver(db: Db, orgId: string) {
  const rader = await db
    .select({
      id: tasks.id,
      tittel: tasks.title,
      frequency: tasks.frequency,
      active: tasks.active,
      startDate: tasks.startDate,
      dueDate: tasks.dueDate,
      sted: tasks.location,
      enhetNavn: units.navn,
      leverandor: vendors.name,
      ansvarligId: tasks.responsibleUserId,
    })
    .from(tasks)
    .leftJoin(vendors, eq(vendors.id, tasks.vendorId))
    .leftJoin(units, eq(units.id, tasks.unitId))
    .where(and(eq(tasks.orgId, orgId), eq(tasks.active, true)));

  // Siste utkvittering per oppgave. Ett oppslag for hele org-en, ikke ett per oppgave.
  const utkvitteringer = await db
    .select({ taskId: completions.taskId, tid: completions.completedAt })
    .from(completions)
    .innerJoin(tasks, eq(tasks.id, completions.taskId))
    .where(eq(tasks.orgId, orgId));

  const sist = new Map<string, string>();
  for (const u of utkvitteringer) {
    const dato = somDato(new Date(u.tid));
    const forrige = sist.get(u.taskId);
    if (!forrige || dato > forrige) sist.set(u.taskId, dato);
  }

  // Navn og e-post på de ansvarlige, til den personlige påminnelsen.
  const ansvarlige = await db
    .select({ id: usersTabell.id, navn: usersTabell.name, epost: usersTabell.email })
    .from(usersTabell);
  const folk = new Map(ansvarlige.map((u) => [u.id, u]));

  return rader
    .filter((t) =>
      erForsinket({
        active: t.active,
        frequency: t.frequency,
        startDate: t.startDate,
        dueDate: t.dueDate,
        lastCompletedAt: sist.get(t.id) ?? null,
      }),
    )
    .map((t) => ({
      tittel: t.tittel,
      sted: t.enhetNavn ?? t.sted,
      leverandor: t.leverandor,
      ansvarligId: t.ansvarligId,
      ansvarligNavn: t.ansvarligId ? (folk.get(t.ansvarligId)?.navn ?? null) : null,
      ansvarligEpost: t.ansvarligId ? (folk.get(t.ansvarligId)?.epost ?? null) : null,
    }));
}

/** Kontrakter som treffer en milepæl i dag. */
async function utlopendeKontrakter(db: Db, orgId: string, iDag: string) {
  const rader = await db
    .select({ tittel: contracts.title, slutt: contracts.endDate, leverandor: vendors.name })
    .from(contracts)
    .leftJoin(vendors, eq(vendors.id, contracts.vendorId))
    .where(
      and(
        eq(contracts.orgId, orgId),
        isNotNull(contracts.endDate),
        // Arkiverte avtaler er bevisst avsluttet — å varsle om at de utløper er støy.
        isNull(contracts.archivedAt),
      ),
    );

  const naa = new Date(`${iDag}T00:00:00Z`).getTime();
  return rader
    .map((k) => ({
      tittel: k.tittel,
      leverandor: k.leverandor,
      dagerIgjen: Math.round((new Date(`${k.slutt!}T00:00:00Z`).getTime() - naa) / 86_400_000),
    }))
    .filter((k) => KONTRAKT_MILEPAELER.has(k.dagerIgjen));
}
