import { lesKropp, orgRute } from "@/lib/api";
import { avvikInn, hentAvvik, opprettAvvik } from "@/lib/avvik";

export const GET = orgRute({
  nivaa: "lesing",
  modul: "avvik",
  handler: ({ db, orgId, req }) => {
    const p = new URL(req.url).searchParams.get("lukkede");
    return hentAvvik(db, orgId, { lukkede: p === null ? undefined : p === "true" });
  },
});

/**
 * `lesing`, ikke `redigering`: å MELDE et avvik skal alle med tilgang kunne gjøre — også
 * `visning`. Det er hele poenget med at nivået heter «visning» og ikke «lesetilgang».
 */
export const POST = orgRute({
  nivaa: "lesing",
  modul: "avvik",
  handler: async ({ db, orgId, bruker, req }) =>
    opprettAvvik(db, orgId, bruker.name, await lesKropp(req, avvikInn)),
});
