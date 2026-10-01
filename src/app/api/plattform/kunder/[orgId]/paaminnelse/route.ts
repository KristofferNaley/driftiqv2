import { aktorFor } from "@/lib/aktor";
import { lesKropp, plattformRute } from "@/lib/api";
import { paaminnelseInn, sendPaminnelse } from "@/lib/kundedetalj";

/** Påminnelse om ett onboarding-punkt til kundens orgadmins. E-posten går etter commit. */
export const POST = plattformRute<{ orgId: string }>({
  nivaa: "plattformadmin",
  handler: async ({ db, bruker, params, req, etterCommit }) =>
    sendPaminnelse(
      db,
      params.orgId,
      (await lesKropp(req, paaminnelseInn)).punkt,
      aktorFor(bruker),
      etterCommit,
    ),
});
