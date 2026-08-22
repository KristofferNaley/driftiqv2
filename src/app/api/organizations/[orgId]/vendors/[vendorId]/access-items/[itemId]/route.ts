import { lesKropp, orgRute } from "@/lib/api";
import { aktorFor } from "@/lib/aktor";
import { adgangInn, endreAdgang, slettAdgang } from "@/lib/leverandorer";

type P = { vendorId: string; itemId: string };

export const PUT = orgRute<P>({
  nivaa: "redigering",
  modul: "leverandorer",
  handler: async ({ db, orgId, bruker, params, req }) =>
    endreAdgang(db, orgId, params.vendorId, params.itemId, await lesKropp(req, adgangInn.partial()), aktorFor(bruker)),
});

export const DELETE = orgRute<P>({
  nivaa: "redigering",
  modul: "leverandorer",
  status: 204,
  handler: ({ db, orgId, bruker, params }) => slettAdgang(db, orgId, params.vendorId, params.itemId, aktorFor(bruker)),
});
