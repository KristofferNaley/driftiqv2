import { aktorFor } from "@/lib/aktor";
import { lesKropp, orgRute } from "@/lib/api";
import { fakturaInn, hentFakturaer, registrerFaktura } from "@/lib/okonomi";

export const GET = orgRute({
  nivaa: "lesing",
  modul: "okonomi",
  handler: ({ db, orgId, req }) => {
    const q = new URL(req.url).searchParams;
    const aar = Number(q.get("aar"));
    return hentFakturaer(db, orgId, {
      status: q.get("status") ?? undefined,
      aar: Number.isInteger(aar) && aar > 0 ? aar : undefined,
    });
  },
});

/** Registrering krever `redigering` — beslutningen (godkjenn/avvis) krever `admin`. */
export const POST = orgRute({
  nivaa: "redigering",
  modul: "okonomi",
  handler: async ({ db, orgId, bruker, req }) =>
    registrerFaktura(db, orgId, aktorFor(bruker), await lesKropp(req, fakturaInn)),
});
