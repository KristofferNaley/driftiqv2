import { readFile } from "node:fs/promises";
import { ApiFeil, orgRute } from "@/lib/api";
import { hentOrg } from "@/lib/organisasjon";
import { contentTypeForFilnavn, filSti } from "@/lib/lagring";

/**
 * Selve bannerbildet. Serveres gjennom API-et som resten av filene — tilgangen går gjennom
 * samme gate, og `inline` fordi eneste bruk er en <img> på dashbordet og i innstillingene.
 */
export const GET = orgRute({
  nivaa: "lesing",
  handler: async ({ db, orgId }) => {
    const org = await hentOrg(db, orgId);
    if (!org.bannerFileName) throw new ApiFeil(404, "Ingen banner lastet opp");

    let innhold: Buffer;
    try {
      innhold = await readFile(filSti(orgId, "org", org.bannerFileName));
    } catch {
      throw new ApiFeil(404, "Fil ikke funnet på disk");
    }
    return {
      innhold,
      navn: org.bannerOriginalName ?? org.bannerFileName,
      contentType: contentTypeForFilnavn(org.bannerFileName),
      disposition: "inline" as const,
    };
  },
});
