import { lesKropp, orgRute } from "@/lib/api";
import { hentOppgave, registrerUtkvittering, utkvitteringInn } from "@/lib/oppgaver";
import { aktorFor } from "@/lib/aktor";
import { APP_URL } from "@/lib/urler";
import { varsleWebhooks } from "@/lib/webhooks";

export const POST = orgRute<{ taskId: string }>({
  nivaa: "redigering",
  modul: "tasks",
  handler: async ({ db, orgId, params, bruker, req, etterCommit }) => {
    // Hentes for webhook-meldingen FØR registreringen — den validerer samtidig at oppgaven
    // finnes i org-en, samme oppslag registrerUtkvittering selv gjør.
    const oppgave = await hentOppgave(db, orgId, params.taskId);
    const utfortAv = aktorFor(bruker);
    const utkvittering = await registrerUtkvittering(
      db, orgId, params.taskId, utfortAv, await lesKropp(req, utkvitteringInn),
    );
    etterCommit(() =>
      varsleWebhooks(orgId, {
        hendelse: "oppgave.fullfort",
        tittel: `Oppgave kvittert ut: ${oppgave.title}`,
        tekst: `Utført av ${utfortAv.navn}`,
        lenke: `${APP_URL}/oppgaver/${params.taskId}`,
        data: { oppgaveId: params.taskId, utfortAv: utfortAv.navn },
      }),
    );
    return utkvittering;
  },
});
