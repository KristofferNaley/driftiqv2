import { aktorFor } from "@/lib/aktor";
import { lesKropp, orgRute } from "@/lib/api";
import { beslutningInn, gjenapneFaktura, godkjennFaktura } from "@/lib/okonomi";

type P = { invoiceId: string };

/** Godkjenning er styrets beslutning — kun kontoadmin. DELETE gjenåpner for ny behandling. */
export const POST = orgRute<P>({
  nivaa: "admin",
  modul: "okonomi",
  handler: async ({ db, orgId, bruker, params, req }) =>
    godkjennFaktura(db, orgId, params.invoiceId, aktorFor(bruker), await lesKropp(req, beslutningInn)),
});

export const DELETE = orgRute<P>({
  nivaa: "admin",
  modul: "okonomi",
  handler: ({ db, orgId, bruker, params }) => gjenapneFaktura(db, orgId, params.invoiceId, aktorFor(bruker)),
});
