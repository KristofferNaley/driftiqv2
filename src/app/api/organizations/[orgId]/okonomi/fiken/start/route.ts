import { orgRute } from "@/lib/api";
import { startOAuth } from "@/lib/fikenkobling";
import { callbackUrl } from "@/lib/fikenurl";

/**
 * Starter OAuth: svarer med redirect til Fiken. Redirect-URI-en bygges fra `Host`, ikke
 * `req.url` — bak proxyen er `req.url` den interne adressen, og Fiken ville sendt brukeren
 * tilbake til feil vert.
 */
export const GET = orgRute({
  nivaa: "admin",
  modul: "okonomi",
  handler: async ({ orgId, req }) => {
    const url = startOAuth(orgId, callbackUrl(req));
    return Response.redirect(url, 302);
  },
});
