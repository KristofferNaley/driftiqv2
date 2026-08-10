import { lesKropp, orgRute } from "@/lib/api";
import { sendLeverandorinfo } from "@/lib/epost";
import { qrInfoInn, sendQrInfo } from "@/lib/leverandorer";

/**
 * Sender meldingen om QR-kvittering til leverandøren.
 *
 * `nivaa: "redigering"` — dette går UT av huset i lagets navn, og en visningsbruker skal kunne
 * lese alt uten å kunne sende e-post på styrets vegne.
 *
 * Selve sendingen skjer i `etterCommit`, ikke inne i handleren: e-posten er en sidevirkning av
 * loggføringen, og et nettverksavbrudd mot Resend skal ikke rulle tilbake notatet om at
 * meldingen ble sendt. Samme mønster som invitasjonen i `users/route.ts`.
 */
export const POST = orgRute<{ vendorId: string }>({
  nivaa: "redigering",
  handler: async ({ db, orgId, bruker, params, req, etterCommit }) => {
    const klar = await sendQrInfo(
      db,
      orgId,
      params.vendorId,
      { navn: bruker.name, epost: bruker.email },
      await lesKropp(req, qrInfoInn),
    );
    etterCommit(() => sendLeverandorinfo(klar));
    return { sendt: true, til: klar.til };
  },
});
