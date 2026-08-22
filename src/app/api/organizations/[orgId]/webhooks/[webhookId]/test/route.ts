import { and, eq } from "drizzle-orm";
import { orgWebhooks } from "@/db/schema/webhooks";
import { ikkeFunnet, orgRute } from "@/lib/api";
import { forStatus, sendTilWebhook } from "@/lib/webhooks";
import { APP_URL } from "@/lib/urler";

/**
 * «Send testmelding». Sender I handleren, med vilje utenom `etterCommit`-regelen: testen ER
 * handlingen (ingen skriving den avhenger av), og svaret skal fortelle brukeren om det gikk
 * — det kan ikke et kall som først kjører etter at svaret er sendt. Prisen er at
 * transaksjonen står åpen mens vi venter (maks 10 s), for ett eksplisitt adminklikk.
 */
export const POST = orgRute<{ webhookId: string }>({
  nivaa: "admin",
  handler: async ({ db, orgId, params }) => {
    const [krok] = await db
      .select()
      .from(orgWebhooks)
      .where(and(eq(orgWebhooks.id, params.webhookId), eq(orgWebhooks.orgId, orgId)))
      .limit(1);
    if (!krok) throw ikkeFunnet("Webhook");

    const resultat = await sendTilWebhook(krok, "DriftIQ", {
      hendelse: "test",
      tittel: "Testmelding",
      tekst: `Webhooken «${krok.name}» er riktig satt opp — varsler herfra vil se slik ut.`,
      lenke: APP_URL,
    });
    await forStatus(db, krok.id, resultat);
    return resultat;
  },
});
