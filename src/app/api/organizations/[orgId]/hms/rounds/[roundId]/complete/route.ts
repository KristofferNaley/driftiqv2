import { fullforRunde } from "@/lib/internkontroll";
import { orgRute } from "@/lib/api";

/** Låser runden. Én vei — den kan ikke gjenåpnes. */
export const POST = orgRute<{ roundId: string }>({
  nivaa: "redigering", modul: "internkontroll",
  handler: ({ db, orgId, params }) => fullforRunde(db, orgId, params.roundId),
});
