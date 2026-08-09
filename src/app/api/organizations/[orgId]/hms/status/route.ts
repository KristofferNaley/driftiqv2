import { orgRute } from "@/lib/api";
import { status } from "@/lib/internkontroll";

/** Hva § 5 krever, og om det er dekket i år. Grunnlaget for oversiktssiden. */
export const GET = orgRute({
  nivaa: "lesing", modul: "internkontroll",
  handler: ({ db, orgId }) => status(db, orgId),
});
