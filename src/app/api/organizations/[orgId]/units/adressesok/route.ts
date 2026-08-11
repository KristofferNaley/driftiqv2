import { orgRute } from "@/lib/api";
import { sokAdresser } from "@/lib/kartverket";

/** Kartverket-proxyen — se lib/kartverket.ts for hvorfor nettleseren ikke kaller Geonorge selv. */
export const GET = orgRute({
  nivaa: "lesing",
  handler: ({ req }) => sokAdresser(new URL(req.url).searchParams.get("adresse") ?? ""),
});
