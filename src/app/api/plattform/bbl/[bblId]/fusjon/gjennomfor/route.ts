import { plattformRute } from "@/lib/api";
import { gjennomforFusjon } from "@/lib/bbl";

export const POST = plattformRute<{ bblId: string }>({
  nivaa: "plattformadmin",
  handler: ({ db, params }) => gjennomforFusjon(db, params.bblId),
});
