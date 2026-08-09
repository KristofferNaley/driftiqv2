import { plattformRute } from "@/lib/api";
import { hentSesjoner } from "@/lib/plattform";

/** `?gjeldende=true` for kun de som gir innsyn akkurat nå. */
export const GET = plattformRute({
  nivaa: "plattformadmin",
  handler: ({ db, req }) =>
    hentSesjoner(db, new URL(req.url).searchParams.get("gjeldende") === "true"),
});
