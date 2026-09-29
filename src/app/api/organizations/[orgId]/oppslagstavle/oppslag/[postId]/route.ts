import { lesKropp, orgRute } from "@/lib/api";
import { endreOppslag, oppslagInn, slettOppslag } from "@/lib/oppslagstavle";

export const PUT = orgRute<{ postId: string }>({
  nivaa: "redigering",
  modul: "oppslagstavle",
  handler: async ({ db, orgId, params, req }) =>
    endreOppslag(db, orgId, params.postId, await lesKropp(req, oppslagInn)),
});

export const DELETE = orgRute<{ postId: string }>({
  nivaa: "redigering",
  modul: "oppslagstavle",
  status: 204,
  handler: ({ db, orgId, params }) => slettOppslag(db, orgId, params.postId),
});
