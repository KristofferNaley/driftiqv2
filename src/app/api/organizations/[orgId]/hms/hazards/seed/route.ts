import { z } from "zod";
import { lesKropp, orgRute } from "@/lib/api";
import { seedFarer } from "@/lib/internkontroll";

const inn = z.object({ templateId: z.string().min(1, "Mal må velges") });

/** Kopierer risikovurderingsmalen inn som lagets farer. Idempotent — se `seedFarer`. */
export const POST = orgRute({
  nivaa: "redigering",
  modul: "internkontroll",
  handler: async ({ db, orgId, req }) => seedFarer(db, orgId, (await lesKropp(req, inn)).templateId),
});
