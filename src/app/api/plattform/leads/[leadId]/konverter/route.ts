import { plattformRute } from "@/lib/api";
import { konverterLead } from "@/lib/leads";

type P = { leadId: string };

/** «Lag kunde» — se `konverterLead` for reglene. Svaret er kunden panelet skal lande på. */
export const POST = plattformRute<P>({
  nivaa: "plattformadmin",
  handler: ({ db, params }) => konverterLead(db, params.leadId),
});
