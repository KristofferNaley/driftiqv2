import { aktorFor } from "@/lib/aktor";
import { lesKropp, plattformRute } from "@/lib/api";
import { hentLeads, leadManuellInn, opprettLeadManuelt } from "@/lib/leads";

export const GET = plattformRute({
  nivaa: "plattformadmin",
  handler: ({ db }) => hentLeads(db),
});

export const POST = plattformRute({
  nivaa: "plattformadmin",
  status: 201,
  handler: async ({ db, bruker, req }) =>
    opprettLeadManuelt(db, await lesKropp(req, leadManuellInn), aktorFor(bruker)),
});
