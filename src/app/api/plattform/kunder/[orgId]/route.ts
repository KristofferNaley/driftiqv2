import { lesKropp, plattformRute } from "@/lib/api";
import { endreKunde, kundeEndring } from "@/lib/kundedetalj";
import { hentKunde } from "@/lib/plattform";

export const GET = plattformRute<{ orgId: string }>({
  nivaa: "plattformadmin",
  handler: ({ db, params }) => hentKunde(db, params.orgId),
});

export const PUT = plattformRute<{ orgId: string }>({
  nivaa: "plattformadmin",
  handler: async ({ db, params, req }) =>
    endreKunde(db, params.orgId, await lesKropp(req, kundeEndring)),
});
