import { lesKropp, orgRute } from "@/lib/api";
import { aktorFor } from "@/lib/aktor";
import { avtaleInn, hentAvtaler, opprettAvtale } from "@/lib/parkering";

export const GET = orgRute({
  nivaa: "lesing",
  modul: "parkering",
  handler: ({ db, orgId }) => hentAvtaler(db, orgId),
});

export const POST = orgRute({
  nivaa: "redigering",
  modul: "parkering",
  handler: async ({ db, orgId, bruker, req }) => opprettAvtale(db, orgId, await lesKropp(req, avtaleInn), aktorFor(bruker)),
});
