import { lesKropp, plattformRute } from "@/lib/api";
import { modulValg, settModuler } from "@/lib/organisasjon";

/**
 * Hvilke moduler en kunde har. **Kun plattformadmin.**
 *
 * Sto tidligere på `orgRute({ nivaa: "admin" })`, og det var feil på en måte som ikke syntes
 * i UI-et: enhver kundes egen kontoadmin kunne skru på hvilken som helst modul for seg selv.
 * Modulene er det kunden har kjøpt — å la dem sette det selv er å gi bort produktet.
 *
 * Å fjerne knappen i kundens innstillinger holder ikke. Endepunktet er offentlig for enhver
 * med et gyldig token, så gaten må stå HER; UI-et er bare speilingen.
 *
 * `plattformRute` gir ingen org-kontekst, og det er riktig her: handleren rører bare
 * `organizations`-raden, som plattformpanelet eier.
 */
export const PUT = plattformRute<{ orgId: string }>({
  nivaa: "plattformadmin",
  handler: async ({ db, params, req }) => {
    const { moduler } = await lesKropp(req, modulValg);
    return settModuler(db, params.orgId, moduler);
  },
});
