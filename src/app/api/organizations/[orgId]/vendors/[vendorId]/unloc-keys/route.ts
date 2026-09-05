import { aktorFor } from "@/lib/aktor";
import { lesKropp, orgRute } from "@/lib/api";
import { delUtNokkel, hentNoklerForLeverandor, nokkelInn } from "@/lib/unlockobling";

type P = { vendorId: string };

/** Fanen «Digitale nøkler» på leverandørkortet. Tilstanden friskes opp fra Unloc ved hver lesing. */
export const GET = orgRute<P>({
  nivaa: "lesing",
  modul: "leverandorer",
  handler: ({ db, orgId, params }) => hentNoklerForLeverandor(db, orgId, params.vendorId),
});

/** Samme nivå som fysiske nøkler og adgangskort (`access-items`); utdeleren lagres på raden. */
export const POST = orgRute<P>({
  nivaa: "redigering",
  modul: "leverandorer",
  status: 201,
  handler: async ({ db, orgId, bruker, params, req }) =>
    delUtNokkel(db, orgId, params.vendorId, aktorFor(bruker), await lesKropp(req, nokkelInn)),
});
