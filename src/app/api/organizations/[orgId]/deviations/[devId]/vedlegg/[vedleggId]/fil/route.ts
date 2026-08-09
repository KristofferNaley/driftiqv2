import { readFile } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { ApiFeil, orgRute } from "@/lib/api";
import { deviationAttachments } from "@/db/schema/avvik";
import { filSti } from "@/lib/lagring";

/** Serveres gjennom API-et, ikke som statisk lenke — tilgangen må gjennom de samme gatene. */
export const GET = orgRute<{ devId: string; vedleggId: string }>({
  nivaa: "lesing",
  modul: "avvik",
  handler: async ({ db, orgId, params }) => {
    const rader = await db
      .select()
      .from(deviationAttachments)
      .where(
        and(
          eq(deviationAttachments.id, params.vedleggId),
          eq(deviationAttachments.deviationId, params.devId),
          eq(deviationAttachments.orgId, orgId),
        ),
      )
      .limit(1);
    const vedlegg = rader[0];
    if (!vedlegg) throw new ApiFeil(404, "Vedlegg ikke funnet");

    try {
      const innhold = await readFile(filSti(orgId, "deviations", vedlegg.filename));
      return { innhold, navn: vedlegg.originalName, contentType: vedlegg.contentType };
    } catch {
      throw new ApiFeil(404, "Fil ikke funnet på disk");
    }
  },
});
