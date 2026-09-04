import { orgRute } from "@/lib/api";
import { hentKjopLokalt, kjopForLeverandor } from "@/lib/fikenkobling";

/** Speilede kjøp — aldri et sanntidskall mot Fiken fra en side. `?vendorId=` gir leverandørkortets utvalg. */
export const GET = orgRute({
  nivaa: "lesing",
  modul: "okonomi",
  handler: ({ db, orgId, req }) => {
    const q = new URL(req.url).searchParams;
    const vendorId = q.get("vendorId");
    if (vendorId) return kjopForLeverandor(db, orgId, vendorId);
    const aar = Number(q.get("aar"));
    return hentKjopLokalt(db, orgId, { aar: Number.isInteger(aar) && aar > 0 ? aar : undefined });
  },
});
