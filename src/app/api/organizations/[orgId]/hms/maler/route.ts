import { orgRute } from "@/lib/api";
import { hentHmsMaler } from "@/lib/internkontroll";

/** De aktive HMS-malene — til malvelgerne i vernerunde og risikovurdering. */
export const GET = orgRute({
  nivaa: "lesing",
  modul: "internkontroll",
  handler: ({ db, req }) => hentHmsMaler(db, new URL(req.url).searchParams.get("type") ?? undefined),
});
