import { orgRute } from "@/lib/api";
import { hentKjopLokalt } from "@/lib/fikenkobling";

/** Speilede kjøp — aldri et sanntidskall mot Fiken fra en side. */
export const GET = orgRute({
  nivaa: "lesing",
  modul: "okonomi",
  handler: ({ db, orgId, req }) => {
    const aar = Number(new URL(req.url).searchParams.get("aar"));
    return hentKjopLokalt(db, orgId, { aar: Number.isInteger(aar) && aar > 0 ? aar : undefined });
  },
});
