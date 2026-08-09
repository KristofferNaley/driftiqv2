import { lesKropp, orgRute } from "@/lib/api";
import { endreKontakt, kontaktInn, slettKontakt } from "@/lib/leverandorer";

type P = { vendorId: string; contactId: string };

export const PUT = orgRute<P>({
  nivaa: "redigering",
  modul: "leverandorer",
  handler: async ({ db, orgId, params, req }) =>
    endreKontakt(db, orgId, params.vendorId, params.contactId, await lesKropp(req, kontaktInn.partial())),
});

export const DELETE = orgRute<P>({
  nivaa: "redigering",
  modul: "leverandorer",
  status: 204,
  handler: ({ db, orgId, params }) => slettKontakt(db, orgId, params.vendorId, params.contactId),
});
