import { withOrg } from "@/db/client";
import { aktorFor } from "@/lib/aktor";
import { hentBruker, tilSvar } from "@/lib/api";
import { fullforOAuth, orgFraState } from "@/lib/fikenkobling";
import { appUrlFra, callbackUrl } from "@/lib/fikenurl";
import { krevOrgAdmin } from "@/lib/tilgang";

/**
 * Fikens OAuth-callback. Registrert hos Fiken som `<app-vert>/api/okonomi/fiken/callback`,
 * uten org i stien — org-id-en kommer i signert `state`. Derfor kan ruta ikke bruke
 * `orgRute`, og gjør det wrapperen ellers gjør, i samme rekkefølge: sesjon → withOrg →
 * kontoadmin-gate → handling. Svaret er en redirect til Integrasjon-fanen, bygget fra Host.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const tilbake = (feil?: string) =>
    Response.redirect(`${appUrlFra(req)}/okonomi?fane=integrasjon${feil ? `&fikenfeil=${encodeURIComponent(feil)}` : ""}`, 302);
  try {
    const feilFraFiken = q.get("error");
    if (feilFraFiken) return tilbake(q.get("error_description") ?? feilFraFiken);
    const code = q.get("code");
    const state = q.get("state");
    if (!code || !state) return tilbake("Mangler kode eller state fra Fiken");

    const orgId = orgFraState(state);
    const bruker = await hentBruker(req);
    await withOrg(orgId, async (db) => {
      await krevOrgAdmin(db, orgId, bruker);
      await fullforOAuth(db, orgId, aktorFor(bruker), code, callbackUrl(req));
    });
    return tilbake();
  } catch (e) {
    const svar = tilSvar(e);
    if (svar.status === 401) return svar;
    const melding = e instanceof Error ? e.message : "Koblingen feilet";
    return tilbake(melding);
  }
}
