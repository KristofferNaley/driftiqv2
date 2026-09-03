import { aktorFor } from "@/lib/aktor";
import { lesKropp, orgRute } from "@/lib/api";
import { avvisFaktura, avvisningInn } from "@/lib/okonomi";

export const POST = orgRute<{ invoiceId: string }>({
  nivaa: "admin",
  modul: "okonomi",
  handler: async ({ db, orgId, bruker, params, req }) =>
    avvisFaktura(db, orgId, params.invoiceId, aktorFor(bruker), await lesKropp(req, avvisningInn)),
});
