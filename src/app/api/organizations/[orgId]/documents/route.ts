import { withOrg } from "@/db/client";
import { ApiFeil, orgRute } from "@/lib/api";
import { dokumentInn, hentDokumenter, lastOppDokument } from "@/lib/dokumenter";
import { uttrekkForDokument } from "@/lib/tekstuttrekk";

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
  handler: async ({ db, orgId, bruker, req, etterCommit }) => {
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
    const ny = await lastOppDokument(db, orgId, bruker.name, fil, data);
    // Tekstuttrekket går etter commit i egen transaksjon: raden må være synlig, og en OCR
    // på 60 sider skal ikke holde opplastingssvaret. Feiler det, tar jobben det om 5 min.
    etterCommit(async () => {
      try {
        await withOrg(orgId, (tdb) => uttrekkForDokument(tdb, orgId, ny.id));
      } catch (e) {
        console.error("[tekstuttrekk] etter opplasting:", e);
      }
    });
    return ny;
  },
});
