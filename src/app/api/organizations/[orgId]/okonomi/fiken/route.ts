import { aktorFor } from "@/lib/aktor";
import { orgRute } from "@/lib/api";
import { hentKobling, kobleFra } from "@/lib/fikenkobling";

/** Status uten hemmeligheter. Lesing for alle med modulen; frakobling er kontoadmin. */
export const GET = orgRute({
  nivaa: "lesing",
  modul: "okonomi",
  handler: ({ db, orgId }) => hentKobling(db, orgId),
});

export const DELETE = orgRute({
  nivaa: "admin",
  modul: "okonomi",
  status: 204,
  handler: ({ db, orgId, bruker }) => kobleFra(db, orgId, aktorFor(bruker)),
});
