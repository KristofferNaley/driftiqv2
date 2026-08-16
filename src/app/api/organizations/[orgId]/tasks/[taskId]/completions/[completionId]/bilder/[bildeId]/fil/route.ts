import { readFile } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { ApiFeil, orgRute } from "@/lib/api";
import { completionPhotos, completions } from "@/db/schema/tasks";
import { filSti } from "@/lib/lagring";

/**
 * Bildet leverandøren tok da de kvitterte ut oppgaven på stedet.
 *
 * Bildene har blitt lagret siden QR-flyten kom, men det fantes ingen vei til å LESE dem —
 * de lå på disk og talte mot kundens kvote uten at styret kunne se dem. Dette er den ruta.
 *
 * `?inline` lar nettleseren vise bildet i stedet for å laste det ned, som i dokumentarkivet
 * og på avviksvedlegg.
 */
export const GET = orgRute<{ taskId: string; completionId: string; bildeId: string }>({
  nivaa: "lesing",
  modul: "tasks",
  handler: async ({ db, orgId, params, req }) => {
    // Joinen mot `completions` er ikke pynt: uten den kunne en bilde-id fra EN ANNEN oppgave
    // i samme org leses gjennom denne oppgavens URL. `org_id` alene stopper ikke det.
    const rader = await db
      .select({ bilde: completionPhotos })
      .from(completionPhotos)
      .innerJoin(completions, eq(completions.id, completionPhotos.completionId))
      .where(
        and(
          eq(completionPhotos.id, params.bildeId),
          eq(completionPhotos.completionId, params.completionId),
          eq(completionPhotos.orgId, orgId),
          eq(completions.taskId, params.taskId),
        ),
      )
      .limit(1);
    const bilde = rader[0]?.bilde;
    if (!bilde) throw new ApiFeil(404, "Bilde ikke funnet");

    try {
      // «completions», samme mappe som opplastingen i lib/qr.ts skriver til.
      const innhold = await readFile(filSti(orgId, "completions", bilde.filename));
      return {
        innhold,
        navn: bilde.originalName,
        contentType: bilde.contentType,
        disposition: new URL(req.url).searchParams.has("inline")
          ? ("inline" as const)
          : ("attachment" as const),
      };
    } catch {
      throw new ApiFeil(404, "Fil ikke funnet på disk");
    }
  },
});
