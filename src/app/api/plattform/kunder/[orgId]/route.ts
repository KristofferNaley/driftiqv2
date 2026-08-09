import { plattformRute } from "@/lib/api";
import { hentKunde } from "@/lib/plattform";

export const GET = plattformRute<{ orgId: string }>({
  nivaa: "plattformadmin",
  handler: ({ db, params }) => hentKunde(db, params.orgId),
});
