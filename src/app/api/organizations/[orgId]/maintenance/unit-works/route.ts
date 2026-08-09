import { lesKropp, orgRute } from "@/lib/api";
import { arbeidInn, hentArbeider, registrerArbeid } from "@/lib/vedlikehold";

export const GET = orgRute({
  nivaa: "lesing", modul: "vedlikehold",
  handler: ({ db, orgId, req }) => {
    const p = new URL(req.url).searchParams;
    return hentArbeider(db, orgId, {
      unitId: p.get("unitId") ?? undefined,
      elementId: p.get("elementId") ?? undefined,
    });
  },
});

/** Enhetsmerket kopieres inn ved registrering — se kommentaren på `unitWorks.unitLabel`. */
export const POST = orgRute({
  nivaa: "redigering", modul: "vedlikehold",
  handler: async ({ db, orgId, bruker, req }) =>
    registrerArbeid(db, orgId, bruker.name, await lesKropp(req, arbeidInn)),
});
