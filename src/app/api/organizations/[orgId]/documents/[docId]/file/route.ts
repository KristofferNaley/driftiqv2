import { readFile } from "node:fs/promises";
import { ApiFeil, orgRute } from "@/lib/api";
import { hentDokument } from "@/lib/dokumenter";
import { filSti } from "@/lib/lagring";

/**
 * Serveres gjennom API-et, ikke som statisk lenke — tilgangen må gjennom de samme gatene.
 * `?inline` lar nettleseren vise fila i stedet for å laste ned — det dokumentviseren bruker.
 */
export const GET = orgRute<{ docId: string }>({
  nivaa: "lesing",
  modul: "dokumentarkiv",
  handler: async ({ db, orgId, params, req }) => {
    const dok = await hentDokument(db, orgId, params.docId);
    try {
      const innhold = await readFile(filSti(orgId, "documents", dok.filename));
      return {
        innhold,
        navn: dok.originalName,
        contentType: dok.contentType,
        disposition: new URL(req.url).searchParams.has("inline") ? ("inline" as const) : ("attachment" as const),
      };
    } catch {
      throw new ApiFeil(404, "Fil ikke funnet på disk");
    }
  },
});
