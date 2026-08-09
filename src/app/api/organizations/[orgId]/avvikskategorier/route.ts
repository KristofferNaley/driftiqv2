import { lesKropp, orgRute } from "@/lib/api";
import { kategoriValg, settKategorier } from "@/lib/organisasjon";

/**
 * `redigering`, ikke `admin`.
 *
 * Kategoriene er navnene folk velger mellom når de melder avvik — driftsinnhold, ikke
 * kontooppsett. Det ville vært rart om den som gjør jobben måtte be en kontoadmin om å legge
 * til en kategori. Samme vurdering som i v1.
 */
export const PUT = orgRute({
  nivaa: "redigering",
  modul: "avvik",
  handler: async ({ db, orgId, req }) =>
    settKategorier(db, orgId, await lesKropp(req, kategoriValg)),
});
