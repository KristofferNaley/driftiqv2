import { aktorFor } from "@/lib/aktor";
import { lesKropp, orgRute } from "@/lib/api";
import { brukForslag, foreslaBudsjett, forslagInn } from "@/lib/okonomi";

type P = { budgetId: string };

/** Forslag fra avtaler og vedlikeholdsplan, justert med `?prosent=`. Skriver ingenting. */
export const GET = orgRute<P>({
  nivaa: "lesing",
  modul: "okonomi",
  handler: ({ db, orgId, params, req }) => {
    const p = Number(new URL(req.url).searchParams.get("prosent"));
    return foreslaBudsjett(db, orgId, params.budgetId, Number.isFinite(p) ? Math.max(-100, Math.min(100, p)) : 0);
  },
});

/** Skriver beløpene styret godtok. */
export const POST = orgRute<P>({
  nivaa: "admin",
  modul: "okonomi",
  handler: async ({ db, orgId, bruker, params, req }) =>
    brukForslag(db, orgId, params.budgetId, aktorFor(bruker), await lesKropp(req, forslagInn)),
});
