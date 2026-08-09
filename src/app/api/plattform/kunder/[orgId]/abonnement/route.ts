import { lesKropp, plattformRute } from "@/lib/api";
import { abonnementInn, settAbonnement, slettAbonnement } from "@/lib/kundedetalj";

export const PUT = plattformRute<{ orgId: string }>({
  nivaa: "plattformadmin",
  handler: async ({ db, params, req }) =>
    settAbonnement(db, params.orgId, await lesKropp(req, abonnementInn)),
});

export const DELETE = plattformRute<{ orgId: string }>({
  nivaa: "plattformadmin",
  handler: ({ db, params }) => slettAbonnement(db, params.orgId),
  status: 204,
});
