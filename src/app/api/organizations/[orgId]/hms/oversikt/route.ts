import { hentOversikt } from "@/lib/internkontroll";
import { orgRute } from "@/lib/api";

/** Internkontrollens forside — alt regnes server-side i ett kall, som dashbordet. */
export const GET = orgRute({ nivaa: "lesing", modul: "internkontroll", handler: ({ db, orgId }) => hentOversikt(db, orgId) });
