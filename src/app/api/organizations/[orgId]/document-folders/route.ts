import { lesKropp, orgRute } from "@/lib/api";
import { hentMapper, mappeInn, opprettMappe } from "@/lib/dokumenter";

export const GET = orgRute({
  nivaa: "lesing",
  modul: "dokumentarkiv",
  handler: ({ db, orgId }) => hentMapper(db, orgId),
});

export const POST = orgRute({
  nivaa: "redigering",
  modul: "dokumentarkiv",
  handler: async ({ db, orgId, req }) => opprettMappe(db, orgId, await lesKropp(req, mappeInn)),
});
