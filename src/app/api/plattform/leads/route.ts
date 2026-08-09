import { plattformRute } from "@/lib/api";
import { hentLeads } from "@/lib/leads";

export const GET = plattformRute({
  nivaa: "plattformadmin",
  handler: ({ db }) => hentLeads(db),
});
