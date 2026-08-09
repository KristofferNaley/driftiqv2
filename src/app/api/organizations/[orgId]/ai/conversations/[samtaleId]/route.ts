import { orgRute } from "@/lib/api";
import { hentSamtale, slettSamtale } from "@/lib/ai";

type P = { samtaleId: string };

export const GET = orgRute<P>({
  nivaa: "lesing", modul: "ai_radgiver",
  handler: ({ db, orgId, bruker, params }) => hentSamtale(db, orgId, bruker.id, params.samtaleId),
});

export const DELETE = orgRute<P>({
  nivaa: "lesing", modul: "ai_radgiver", status: 204,
  handler: ({ db, orgId, bruker, params }) => slettSamtale(db, orgId, bruker.id, params.samtaleId),
});
