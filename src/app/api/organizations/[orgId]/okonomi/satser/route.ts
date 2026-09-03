import { orgRute } from "@/lib/api";
import { hentSatser } from "@/lib/okonomi";

/** Satsene slik de gjelder på `?dato=` (standard i dag). */
export const GET = orgRute({
  nivaa: "lesing",
  modul: "okonomi",
  handler: ({ db, orgId, req }) => {
    const dato = new URL(req.url).searchParams.get("dato");
    return hentSatser(db, orgId, dato && /^\d{4}-\d{2}-\d{2}$/.test(dato) ? dato : undefined);
  },
});
