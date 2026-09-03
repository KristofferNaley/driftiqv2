import { aktorFor } from "@/lib/aktor";
import { lesKropp, orgRute } from "@/lib/api";
import { endreFaktura, fakturaEndring, hentFaktura, slettFaktura } from "@/lib/okonomi";

type P = { invoiceId: string };

export const GET = orgRute<P>({
  nivaa: "lesing",
  modul: "okonomi",
  handler: ({ db, orgId, params }) => hentFaktura(db, orgId, params.invoiceId),
});

export const PUT = orgRute<P>({
  nivaa: "redigering",
  modul: "okonomi",
  handler: async ({ db, orgId, params, req }) =>
    endreFaktura(db, orgId, params.invoiceId, await lesKropp(req, fakturaEndring)),
});

export const DELETE = orgRute<P>({
  nivaa: "redigering",
  modul: "okonomi",
  status: 204,
  handler: ({ db, orgId, bruker, params }) => slettFaktura(db, orgId, params.invoiceId, aktorFor(bruker)),
});
