import { lesKropp, orgRute } from "@/lib/api";
import { endreService, serviceInn, slettService } from "@/lib/vedlikehold";

type P = { elementId: string; serviceId: string };

export const PUT = orgRute<P>({
  nivaa: "redigering", modul: "vedlikehold",
  handler: async ({ db, orgId, params, req }) =>
    endreService(db, orgId, params.elementId, params.serviceId, await lesKropp(req, serviceInn.partial())),
});

export const DELETE = orgRute<P>({
  nivaa: "redigering", modul: "vedlikehold", status: 204,
  handler: ({ db, orgId, params }) => slettService(db, orgId, params.elementId, params.serviceId),
});
