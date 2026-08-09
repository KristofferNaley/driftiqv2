import { lesKropp, orgRute } from "@/lib/api";
import { adgangInn, endreAdgang, slettAdgang } from "@/lib/leverandorer";

type P = { vendorId: string; itemId: string };

export const PUT = orgRute<P>({
  nivaa: "redigering",
  modul: "leverandorer",
  handler: async ({ db, orgId, params, req }) =>
    endreAdgang(db, orgId, params.vendorId, params.itemId, await lesKropp(req, adgangInn.partial())),
});

export const DELETE = orgRute<P>({
  nivaa: "redigering",
  modul: "leverandorer",
  status: 204,
  handler: ({ db, orgId, params }) => slettAdgang(db, orgId, params.vendorId, params.itemId),
});
