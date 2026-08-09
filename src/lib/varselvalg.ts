/**
 * Varselvalgene. **Ingen importer** — fila leses både av API-et og av nettleseren, og en
 * server-import her ville dratt databasedriveren inn i klientbundlet (se `nivaer.ts`).
 *
 * ## Hvorfor valgene ligger på MEDLEMSKAPET
 *
 * v1 la dem først på organisasjonen: ett sett brytere og ÉN e-postadresse for hele laget.
 * Det skalerte dårlig — «Aktivitet på mine avvik» er per definisjon personlig, og de andre
 * varslene traff bare den ene adressen noen hadde skrevet inn. Nå ligger de på
 * `user_org_memberships`, og hvert varsel går til mottakerens egen adresse.
 *
 * At de ligger på medlemskapet og ikke på brukeren er med vilje: samme person kan sitte i
 * flere boligselskap og vil sjelden ha samme oppsett i alle.
 */

export type VarselNokkel =
  | "deviation_activity"
  | "my_overdue_task"
  | "new_deviation"
  | "overdue_task"
  | "contract_expiring";

/**
 * Nøkkel → standardverdi for et nytt medlemskap.
 *
 * De to PERSONLIGE varslene (noe skjer med mitt avvik, min oppgave er forsinket) er på som
 * standard — de handler om ens eget ansvar og er sjelden støy. De tre andre er sammendrag
 * for hele laget; å slå dem på for alle ville gitt hele styret den samme e-posten hver
 * mandag fra dag én. De slås på av den som faktisk vil ha dem.
 */
export const VARSEL_STANDARD: Record<VarselNokkel, boolean> = {
  deviation_activity: true,
  my_overdue_task: true,
  new_deviation: false,
  overdue_task: false,
  contract_expiring: false,
};

export const VARSLER: ReadonlyArray<{
  nokkel: VarselNokkel;
  etikett: string;
  beskrivelse: string;
}> = [
  {
    nokkel: "deviation_activity",
    etikett: "Aktivitet på mine avvik",
    beskrivelse: "Når et avvik du er ansvarlig for endres, får ny behandling eller lukkes.",
  },
  {
    nokkel: "my_overdue_task",
    etikett: "Mine oppgaver blir forsinket",
    beskrivelse: "Ukentlig påminnelse om oppgaver du er ansvarlig for som har passert fristen.",
  },
  {
    nokkel: "new_deviation",
    etikett: "Nytt avvik i laget",
    beskrivelse: "Når noen melder et nytt avvik — også via QR-koden.",
  },
  {
    nokkel: "overdue_task",
    etikett: "Forsinkede oppgaver",
    beskrivelse: "Ukentlig sammendrag på mandager over oppgaver som har passert fristen.",
  },
  {
    nokkel: "contract_expiring",
    etikett: "Kontrakt utløper snart",
    beskrivelse: "Ved 180, 90, 30, 14 og 7 dager igjen av en avtale.",
  },
];

export const VARSEL_NOKLER = VARSLER.map((v) => v.nokkel);
