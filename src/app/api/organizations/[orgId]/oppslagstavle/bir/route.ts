import { lesKropp, orgRute } from "@/lib/api";
import { aktorFor } from "@/lib/aktor";
import { birValg, hentBirStatus, kobleBir, kobleFraBir } from "@/lib/birkobling";

/** Tømmedager fra BIR (docs/bir.md). `null` = ikke koblet. */
export const GET = orgRute({
  nivaa: "lesing",
  modul: "oppslagstavle",
  handler: ({ db, orgId }) => hentBirStatus(db, orgId),
});

export const PUT = orgRute({
  nivaa: "redigering",
  modul: "oppslagstavle",
  handler: async ({ db, orgId, bruker, req }) => kobleBir(db, orgId, aktorFor(bruker), await lesKropp(req, birValg)),
});

export const DELETE = orgRute({
  nivaa: "redigering",
  modul: "oppslagstavle",
  status: 204,
  handler: ({ db, orgId, bruker }) => kobleFraBir(db, orgId, aktorFor(bruker)),
});
