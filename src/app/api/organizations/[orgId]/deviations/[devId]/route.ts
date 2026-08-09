import { lesKropp, orgRute } from "@/lib/api";
import { avvikEndring, endreAvvik, hentEttAvvik } from "@/lib/avvik";

type P = { devId: string };

export const GET = orgRute<P>({
  nivaa: "lesing",
  modul: "avvik",
  handler: ({ db, orgId, params }) => hentEttAvvik(db, orgId, params.devId),
});

export const PUT = orgRute<P>({
  nivaa: "redigering",
  modul: "avvik",
  handler: async ({ db, orgId, params, bruker, req }) =>
    endreAvvik(db, orgId, params.devId, bruker.name, await lesKropp(req, avvikEndring)),
});
