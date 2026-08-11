import { ApiFeil, orgRute } from "@/lib/api";
import { fjernBanner, lastOppBanner } from "@/lib/organisasjon";

/**
 * Dashbordbanneret — kontooppsett, derfor `orgadmin` på begge skriveveiene: bildet vises
 * øverst på dashbordet for ALLE i laget, og hvem som bestemmer det er et adminvalg.
 */
export const POST = orgRute({
  nivaa: "admin",
  handler: async ({ db, orgId, req }) => {
    const form = await req.formData();
    const fil = form.get("file");
    if (!(fil instanceof File)) throw new ApiFeil(400, "Ingen fil i forespørselen");
    return lastOppBanner(db, orgId, fil);
  },
});

export const DELETE = orgRute({
  nivaa: "admin",
  handler: ({ db, orgId }) => fjernBanner(db, orgId),
});
