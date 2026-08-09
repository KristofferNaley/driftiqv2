import { plattformRute } from "@/lib/api";
import { hentDetalj } from "@/lib/kundedetalj";

export const GET = plattformRute<{ orgId: string }>({
  nivaa: "plattformadmin",
  handler: ({ db, params }) => hentDetalj(db, params.orgId),
});
