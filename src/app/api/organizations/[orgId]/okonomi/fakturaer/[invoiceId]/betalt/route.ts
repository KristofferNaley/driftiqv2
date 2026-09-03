import { aktorFor } from "@/lib/aktor";
import { lesKropp, orgRute } from "@/lib/api";
import { betaltInn, markerBetalt } from "@/lib/okonomi";

/** Betalt registreres av den som betalte — `redigering` holder; beslutningen er alt tatt. */
export const POST = orgRute<{ invoiceId: string }>({
  nivaa: "redigering",
  modul: "okonomi",
  handler: async ({ db, orgId, bruker, params, req }) =>
    markerBetalt(db, orgId, params.invoiceId, aktorFor(bruker), await lesKropp(req, betaltInn)),
});
