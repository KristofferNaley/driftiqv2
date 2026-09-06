import { aktorFor } from "@/lib/aktor";
import { lesKropp, orgRute } from "@/lib/api";
import { hentPrisplaner, lagrePrisplan, prisplanInn } from "@/lib/easeekobling";

/** Prisplanene for lading (lib/laderegler.ts). Lesing for alle med modulen; endring er kontoadmin — det er fakturagrunnlag. */
export const GET = orgRute({
  nivaa: "lesing",
  modul: "parkering",
  handler: ({ db, orgId }) => hentPrisplaner(db, orgId),
});

export const POST = orgRute({
  nivaa: "admin",
  modul: "parkering",
  status: 201,
  handler: async ({ db, orgId, bruker, req }) => lagrePrisplan(db, orgId, aktorFor(bruker), await lesKropp(req, prisplanInn)),
});
