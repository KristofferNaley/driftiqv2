import { withoutRls } from "@/db/client";
import { lesKropp, tilSvar } from "@/lib/api";
import { leadInn, registrerLead } from "@/lib/leads";
import { sendNyLead } from "@/lib/epost";

/**
 * Kontaktskjemaet på landingssiden. **Offentlig og uautentisert.**
 *
 * Bruker verken `orgRute` eller `plattformRute`: en lead er per definisjon noen som ikke har
 * konto. `"plattformpanel"` som RLS-grunn — tabellen har ingen `org_id` å filtrere på.
 *
 * Svaret er ALLTID det samme, også når honningkrukka slår til. En robot som får en
 * feilmelding, prøver på nytt med en annen taktikk.
 */
export async function POST(req: Request) {
  try {
    const data = await lesKropp(req, leadInn);
    const resultat = await withoutRls("plattformpanel", (db) => registrerLead(db, data));

    // Varselet må ikke kunne velte innsendingen: leaden ER lagret, og at e-posten ikke kom
    // fram er en driftssak. Uten dette ville en nede Resend gitt besøkende en feilmelding
    // på noe som faktisk gikk bra.
    if (resultat.lagret) {
      await sendNyLead(resultat.lead).catch((e) => console.error("[leads] Varsel feilet:", e));
    }
    return Response.json({ mottatt: true });
  } catch (e) {
    return tilSvar(e);
  }
}
