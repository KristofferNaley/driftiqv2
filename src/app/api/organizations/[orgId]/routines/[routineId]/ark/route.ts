import { orgRute } from "@/lib/api";
import { hentRutineark } from "@/lib/ark";

/** Alt rutinearket trenger, inkludert QR-koden som data-URI. Se lib/ark.ts. */
export const GET = orgRute<{ routineId: string }>({
  nivaa: "lesing",
  modul: "rutiner",
  handler: ({ db, orgId, params }) => hentRutineark(db, orgId, params.routineId),
});
