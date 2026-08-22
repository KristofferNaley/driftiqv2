import { plattformRute } from "@/lib/api";
import { hentAuthHendelser } from "@/lib/hendelser";

/**
 * Innloggingsloggen (`auth_events`). Kun plattformpanelet: tabellen er på brukernivå og
 * skal aldri eksponeres per org — se kommentaren i skjemafila.
 */
export const GET = plattformRute({
  nivaa: "plattformadmin",
  handler: ({ db, req }) => {
    const side = Number(new URL(req.url).searchParams.get("side")) || 0;
    return hentAuthHendelser(db, { side });
  },
});
