import { ApiFeil, orgRute } from "@/lib/api";
import { dokumentInn, hentDokumenter, lastOppDokument } from "@/lib/dokumenter";

export const GET = orgRute({
  nivaa: "lesing",
  modul: "dokumentarkiv",
  handler: ({ db, orgId, req }) =>
    hentDokumenter(db, orgId, new URL(req.url).searchParams.get("mappe") ?? undefined),
});

/**
 * Fil og metadata i samme forespørsel — multipart. Metadatafeltene kommer som strenger
 * fra skjemaet, så `aiReadable` må tolkes eksplisitt: en `FormData`-verdi er aldri boolsk.
 */
export const POST = orgRute({
  nivaa: "redigering",
  modul: "dokumentarkiv",
  handler: async ({ db, orgId, bruker, req }) => {
    const form = await req.formData();
    const fil = form.get("file");
    if (!(fil instanceof File)) throw new ApiFeil(400, "Ingen fil i forespørselen");

    const tekst = (n: string) => {
      const v = form.get(n);
      return typeof v === "string" && v !== "" ? v : undefined;
    };
    const data = dokumentInn.parse({
      title: tekst("title") ?? fil.name,
      description: tekst("description") ?? null,
      folder: tekst("folder"),
      documentDate: tekst("documentDate") ?? null,
      aiReadable: form.get("aiReadable") === "true",
    });
    return lastOppDokument(db, orgId, bruker.name, fil, data);
  },
});
