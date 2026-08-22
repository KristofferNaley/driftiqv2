import { lesKropp, orgRute } from "@/lib/api";
import { aktorFor } from "@/lib/aktor";
import { endreWebhook, slettWebhook, webhookInn } from "@/lib/webhooks";

export const PUT = orgRute<{ webhookId: string }>({
  nivaa: "admin",
  handler: async ({ db, orgId, params, bruker, req }) =>
    endreWebhook(db, orgId, params.webhookId, aktorFor(bruker), await lesKropp(req, webhookInn)),
});

export const DELETE = orgRute<{ webhookId: string }>({
  nivaa: "admin",
  status: 204,
  handler: async ({ db, orgId, params, bruker }) => {
    await slettWebhook(db, orgId, params.webhookId, aktorFor(bruker));
  },
});
