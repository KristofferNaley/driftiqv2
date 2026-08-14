import { hentGjennomgang } from "@/lib/internkontroll";
import { orgRute } from "@/lib/api";

/** Kun GET: protokollen er låst — ingen PUT, ingen DELETE. */
type P = { reviewId: string };
export const GET = orgRute<P>({ nivaa: "lesing", modul: "internkontroll", handler: ({ db, orgId, params }) => hentGjennomgang(db, orgId, params.reviewId) });
