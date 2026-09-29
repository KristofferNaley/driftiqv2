import { lesKropp, orgRute } from "@/lib/api";
import { blokkInn, endreBlokk, slettBlokk } from "@/lib/tavleblokker";

export const PUT = orgRute<{ blokkId: string }>({
  nivaa: "redigering",
  modul: "oppslagstavle",
  handler: async ({ db, orgId, params, req }) => endreBlokk(db, orgId, params.blokkId, await lesKropp(req, blokkInn)),
});

export const DELETE = orgRute<{ blokkId: string }>({
  nivaa: "redigering",
  modul: "oppslagstavle",
  status: 204,
  handler: ({ db, orgId, params }) => slettBlokk(db, orgId, params.blokkId),
});
