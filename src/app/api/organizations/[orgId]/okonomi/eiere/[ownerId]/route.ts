import { aktorFor } from "@/lib/aktor";
import { lesKropp, orgRute } from "@/lib/api";
import { eierEndring, endreEier, slettEier } from "@/lib/okonomi";

type P = { ownerId: string };

export const PUT = orgRute<P>({
  nivaa: "admin",
  modul: "okonomi",
  handler: async ({ db, orgId, params, req }) =>
    endreEier(db, orgId, params.ownerId, await lesKropp(req, eierEndring)),
});

export const DELETE = orgRute<P>({
  nivaa: "admin",
  modul: "okonomi",
  status: 204,
  handler: ({ db, orgId, bruker, params }) => slettEier(db, orgId, params.ownerId, aktorFor(bruker)),
});
