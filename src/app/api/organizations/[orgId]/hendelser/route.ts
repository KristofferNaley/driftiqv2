import { orgRute } from "@/lib/api";
import { hentHendelser } from "@/lib/hendelser";

/**
 * Hendelsesloggen — «hvem gjorde hva». `admin` og ingen `modul`: dette er org-metadata på
 * linje med brukerlista, og strengt med vilje — loggen viser tilgangsendringer og slettinger
 * på tvers av alle modulene.
 */
export const GET = orgRute({
  nivaa: "admin",
  handler: ({ db, orgId, req }) => {
    const sok = new URL(req.url).searchParams;
    return hentHendelser(db, orgId, {
      modul: sok.get("modul") ?? undefined,
      aktorUserId: sok.get("aktor") ?? undefined,
      side: Number(sok.get("side")) || 0,
    });
  },
});
