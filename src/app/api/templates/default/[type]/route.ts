import { ApiFeil, plattformRute } from "@/lib/api";
import { MALTYPER, hentStandardmal, type Maltype } from "@/lib/maler";

/** Malen kunde-appen får når den ikke ber om en bestemt. */
export const GET = plattformRute<{ type: string }>({
  nivaa: "alle",
  handler: ({ db, params }) => {
    if (!MALTYPER.includes(params.type as Maltype)) throw new ApiFeil(400, "Ukjent maltype");
    return hentStandardmal(db, params.type as Maltype);
  },
});
