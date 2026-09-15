import { lesKropp, orgRute } from "@/lib/api";
import { anleggInn, hentAnleggFor } from "@/lib/easeekobling";

/**
 * Anleggene en Easee-konto når — første steg i tilkoblingen (docs/easee.md). Kontoadmin,
 * som selve tilkoblingen: brukernavn og passord går inn, ingenting lagres.
 */
export const POST = orgRute({
  nivaa: "admin",
  modul: "parkering",
  handler: async ({ req }) => hentAnleggFor(await lesKropp(req, anleggInn)),
});
