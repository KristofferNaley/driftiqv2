import { aktorFor } from "@/lib/aktor";
import { lesKropp, orgRute } from "@/lib/api";
import { hentLadekjoringer, ladekjoringInn, opprettLadekjoring } from "@/lib/ladekjoring";

/** Ladekjøringene — fakturagrunnlaget for strøm til lading (docs/easee.md «Etappe 3»). */
export const GET = orgRute({
  nivaa: "lesing",
  modul: "okonomi",
  handler: ({ db, orgId }) => hentLadekjoringer(db, orgId),
});

export const POST = orgRute({
  nivaa: "admin",
  modul: "okonomi",
  status: 201,
  handler: async ({ db, orgId, bruker, req }) => opprettLadekjoring(db, orgId, aktorFor(bruker), await lesKropp(req, ladekjoringInn)),
});
