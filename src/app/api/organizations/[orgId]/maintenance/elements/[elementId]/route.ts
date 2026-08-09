import { lesKropp, orgRute } from "@/lib/api";
import { elementEndring, endreElement, hentElement, slettElement } from "@/lib/vedlikehold";

type P = { elementId: string };

export const GET = orgRute<P>({
  nivaa: "lesing", modul: "vedlikehold",
  handler: ({ db, orgId, params }) => hentElement(db, orgId, params.elementId),
});

export const PUT = orgRute<P>({
  nivaa: "redigering", modul: "vedlikehold",
  handler: async ({ db, orgId, params, req }) =>
    endreElement(db, orgId, params.elementId, await lesKropp(req, elementEndring)),
});

/** Enhetsarbeider blir stående med elementId = NULL — arbeidet ble faktisk gjort. */
export const DELETE = orgRute<P>({
  nivaa: "redigering", modul: "vedlikehold", status: 204,
  handler: ({ db, orgId, params }) => slettElement(db, orgId, params.elementId),
});
