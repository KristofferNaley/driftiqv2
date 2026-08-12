import { lesKropp, plattformRute } from "@/lib/api";
import { leadStatusInn, settLeadStatus, slettLead } from "@/lib/leads";

type P = { leadId: string };

export const PUT = plattformRute<P>({
  nivaa: "plattformadmin",
  handler: async ({ db, params, req }) =>
    settLeadStatus(db, params.leadId, (await lesKropp(req, leadStatusInn)).status),
});

export const DELETE = plattformRute<P>({
  nivaa: "plattformadmin",
  status: 204,
  handler: ({ db, params }) => slettLead(db, params.leadId),
});
