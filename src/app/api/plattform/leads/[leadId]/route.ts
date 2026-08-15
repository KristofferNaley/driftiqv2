import { aktorFor } from "@/lib/aktor";
import { lesKropp, plattformRute } from "@/lib/api";
import { leadOppdaterInn, oppdaterLead, slettLead } from "@/lib/leads";

type P = { leadId: string };

export const PUT = plattformRute<P>({
  nivaa: "plattformadmin",
  handler: async ({ db, bruker, params, req }) =>
    oppdaterLead(db, params.leadId, await lesKropp(req, leadOppdaterInn), aktorFor(bruker)),
});

export const DELETE = plattformRute<P>({
  nivaa: "plattformadmin",
  status: 204,
  handler: ({ db, params }) => slettLead(db, params.leadId),
});
