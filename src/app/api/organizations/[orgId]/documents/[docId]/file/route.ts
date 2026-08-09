import { readFile } from "node:fs/promises";
import { ApiFeil, orgRute } from "@/lib/api";
import { hentDokument } from "@/lib/dokumenter";
import { filSti } from "@/lib/lagring";

/** Serveres gjennom API-et, ikke som statisk lenke — tilgangen må gjennom de samme gatene. */
export const GET = orgRute<{ docId: string }>({
  nivaa: "lesing",
  modul: "dokumentarkiv",
  handler: async ({ db, orgId, params }) => {
    const dok = await hentDokument(db, orgId, params.docId);
    try {
      const innhold = await readFile(filSti(orgId, "documents", dok.filename));
      return { innhold, navn: dok.originalName, contentType: dok.contentType };
    } catch {
      throw new ApiFeil(404, "Fil ikke funnet på disk");
    }
  },
});
