import { lesKropp, plattformRute } from "@/lib/api";
import { orgnrOppslag, slaOppOrgnr } from "@/lib/kundedetalj";

/** «Slå opp» fra «Krever handling»: setter org.nr og fyller tomme felt fra Enhetsregisteret. */
export const POST = plattformRute<{ orgId: string }>({
  nivaa: "plattformadmin",
  handler: async ({ db, params, req }) =>
    slaOppOrgnr(db, params.orgId, (await lesKropp(req, orgnrOppslag)).orgNr),
});
