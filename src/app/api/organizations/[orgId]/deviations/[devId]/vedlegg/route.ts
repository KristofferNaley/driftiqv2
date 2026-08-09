import { orgRute, ugyldig } from "@/lib/api";
import { lastOppVedlegg } from "@/lib/avvik";

/**
 * `redigering`, ikke `lesing`: å MELDE et avvik skal alle kunne, men å legge dokumentasjon
 * til en pågående sak er å endre den. Visningsbrukere melder — de behandler ikke.
 */
export const POST = orgRute<{ devId: string }>({
  nivaa: "redigering",
  modul: "avvik",
  handler: async ({ db, orgId, bruker, params, req }) => {
    const skjema = await req.formData();
    const fil = skjema.get("fil");
    if (!(fil instanceof File)) throw ugyldig("Mangler fil");
    const behandling = skjema.get("behandlingId");
    return lastOppVedlegg(
      db,
      orgId,
      params.devId,
      bruker.name,
      fil,
      typeof behandling === "string" && behandling ? behandling : null,
    );
  },
});
