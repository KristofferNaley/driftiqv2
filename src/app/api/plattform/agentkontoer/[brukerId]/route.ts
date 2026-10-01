import { lesKropp, plattformRute } from "@/lib/api";
import { agentkontoInn, settAgentkonto } from "@/lib/plattform";

/** Merker en kundebruker som agentkonto, så den ikke teller som styret (lib/kundebrukere.ts). */
export const PUT = plattformRute<{ brukerId: string }>({
  nivaa: "plattformadmin",
  handler: async ({ db, params, req }) =>
    settAgentkonto(db, params.brukerId, (await lesKropp(req, agentkontoInn)).agent),
});
