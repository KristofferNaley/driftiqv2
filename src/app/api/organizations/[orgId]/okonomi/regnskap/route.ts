import { orgRute } from "@/lib/api";
import { hentRegnskap } from "@/lib/regnskapskobling";

/** Hvilket regnskapssystem orgen er koblet til, og om det kan fakturere — uten hemmeligheter. */
export const GET = orgRute({
  nivaa: "lesing",
  modul: "okonomi",
  handler: ({ db, orgId }) => hentRegnskap(db, orgId),
});
