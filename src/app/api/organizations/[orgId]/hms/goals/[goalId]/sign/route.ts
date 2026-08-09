import { orgRute } from "@/lib/api";
import { fjernSignatur, signerMal } from "@/lib/internkontroll";

type P = { goalId: string };

/**
 * Signaturen er personlig. Bruker-id-en kommer fra sesjonen og aldri fra kroppen — ellers
 * kunne ett styremedlem signert på vegne av de andre.
 *
 * `lesing` og ikke `redigering`: å signere er ikke å redigere målet, og et styremedlem med
 * visningstilgang skal kunne bekrefte at de kjenner det.
 */
export const POST = orgRute<P>({
  nivaa: "lesing", modul: "internkontroll",
  handler: ({ db, orgId, params, bruker }) => signerMal(db, orgId, params.goalId, bruker.id),
});

export const DELETE = orgRute<P>({
  nivaa: "lesing", modul: "internkontroll", status: 204,
  handler: ({ db, orgId, params, bruker }) => fjernSignatur(db, orgId, params.goalId, bruker.id),
});
