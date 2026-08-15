/**
 * Typene i «Meld feil». **Ingen importer** — brukes både av API-et og av nettleseren.
 *
 * Ligger i en egen fil av samme grunn som `nivaer.ts` og `avvikkategorier.ts`: la de i
 * `feilmelding.ts`, som importerer databaseklienten, dro panelsiden hele `pg`-driveren inn i
 * nettleserbundlet og bygget feilet med «Can't resolve 'dns'».
 *
 * Dette har skjedd tre ganger nå. Derfor er `db/client.ts` merket med `server-only`: neste
 * gang feiler bygget med «You're importing a component that needs server-only», som peker
 * rett på problemet i stedet for på en manglende Node-modul.
 */

export const TYPER = ["bug", "idea", "question"] as const;

export const TYPE_ETIKETT: Record<string, string> = {
  bug: "Feil",
  idea: "Forslag",
  question: "Spørsmål",
};

export const STATUS_ETIKETT: Record<string, string> = {
  ny: "Ny",
  under_arbeid: "Under arbeid",
  venter_kunde: "Venter på kunde",
  lost: "Løst",
};
