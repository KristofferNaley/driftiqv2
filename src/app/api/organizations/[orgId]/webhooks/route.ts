/**
 * Kundens webhooks. Ingen `modul` oppgis: dette ligger som fane under Innstillinger og er
 * kontooppsett, ikke en modul som kan slås av — samme begrunnelse som enhetsregisteret.
 * `admin` på alt, også GET: URL-ene gir skrivetilgang til styrets kanaler.
 */
import { lesKropp, orgRute } from "@/lib/api";
import { aktorFor } from "@/lib/aktor";
import { hentWebhooks, opprettWebhook, webhookInn } from "@/lib/webhooks";

export const GET = orgRute({
  nivaa: "admin",
  handler: ({ db, orgId }) => hentWebhooks(db, orgId),
});

export const POST = orgRute({
  nivaa: "admin",
  handler: async ({ db, orgId, bruker, req }) =>
    opprettWebhook(db, orgId, aktorFor(bruker), await lesKropp(req, webhookInn)),
});
