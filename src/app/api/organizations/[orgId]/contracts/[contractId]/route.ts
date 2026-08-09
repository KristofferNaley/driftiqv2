import { lesKropp, orgRute } from "@/lib/api";
import { endreKontrakt, hentKontrakt, kontraktEndring } from "@/lib/kontrakter";

type P = { contractId: string };

export const GET = orgRute<P>({
  nivaa: "lesing",
  modul: "kontrakter",
  handler: ({ db, orgId, params }) => hentKontrakt(db, orgId, params.contractId),
});

export const PUT = orgRute<P>({
  nivaa: "redigering",
  modul: "kontrakter",
  handler: async ({ db, orgId, params, req }) =>
    endreKontrakt(db, orgId, params.contractId, await lesKropp(req, kontraktEndring)),
});
