import { aktorFor } from "@/lib/aktor";
import { orgRute } from "@/lib/api";
import { tilbakekall } from "@/lib/unlockobling";

type P = { vendorId: string; keyId: string };

/** Tilbakekalling — raden blir stående som historikk, med hvem som kalte tilbake. */
export const DELETE = orgRute<P>({
  nivaa: "redigering",
  modul: "leverandorer",
  status: 204,
  handler: ({ db, orgId, bruker, params }) => tilbakekall(db, orgId, params.vendorId, params.keyId, aktorFor(bruker)),
});
