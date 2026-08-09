import { lesKropp, orgRute } from "@/lib/api";
import { hentLeverandorer, leverandorInn, opprettLeverandor } from "@/lib/leverandorer";

export const GET = orgRute({
  nivaa: "lesing",
  modul: "leverandorer",
  handler: ({ db, orgId, req }) => {
    const p = new URL(req.url).searchParams.get("aktive");
    return hentLeverandorer(db, orgId, { aktive: p === null ? undefined : p === "true" });
  },
});

export const POST = orgRute({
  nivaa: "redigering",
  modul: "leverandorer",
  handler: async ({ db, orgId, req }) => opprettLeverandor(db, orgId, await lesKropp(req, leverandorInn)),
});
