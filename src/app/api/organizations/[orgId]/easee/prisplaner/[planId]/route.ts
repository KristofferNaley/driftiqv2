import { aktorFor } from "@/lib/aktor";
import { lesKropp, orgRute } from "@/lib/api";
import { lagrePrisplan, prisplanInn, slettPrisplan } from "@/lib/easeekobling";

type P = { planId: string };

export const PUT = orgRute<P>({
  nivaa: "admin",
  modul: "parkering",
  handler: async ({ db, orgId, bruker, params, req }) => lagrePrisplan(db, orgId, aktorFor(bruker), await lesKropp(req, prisplanInn), params.planId),
});

export const DELETE = orgRute<P>({
  nivaa: "admin",
  modul: "parkering",
  status: 204,
  handler: ({ db, orgId, bruker, params }) => slettPrisplan(db, orgId, aktorFor(bruker), params.planId),
});
