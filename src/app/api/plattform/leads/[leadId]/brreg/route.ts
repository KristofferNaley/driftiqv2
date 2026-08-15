import { aktorFor } from "@/lib/aktor";
import { plattformRute } from "@/lib/api";
import { oppdaterLeadBrreg } from "@/lib/leads";

type P = { leadId: string };

/** Ferskt oppslag mot Enhetsregisteret på leadens org.nr. */
export const POST = plattformRute<P>({
  nivaa: "plattformadmin",
  handler: ({ db, bruker, params }) => oppdaterLeadBrreg(db, params.leadId, aktorFor(bruker)),
});
