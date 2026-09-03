/**
 * Drizzle-skjema for v2.
 *
 * Bare de tabellene som er portert så langt ligger her. RLS-registeret i `../rls/tables.ts`
 * bærer derimot HELE lista fra v1 fra dag én — `settOpp()` hopper over tabeller som ikke
 * finnes ennå. Rekkefølgen er med vilje: sikkerhetsspesifikasjonen skal være komplett før
 * modulene kommer, ikke vokse etter dem.
 *
 * Kolonnene speiler `backend/app/models.py` felt for felt der de finnes, slik at data kan
 * kopieres over uten oversettelseslag. Merk at id og org_id er VARCHAR og ikke `uuid` — en
 * arv fra v1 som beholdes bevisst, siden RLS-policyene sammenligner mot en tekstverdi og en
 * `::uuid`-cast ville feilet med «invalid input syntax».
 */

export * from "./organizations";
export * from "./users";
export * from "./auth";
export * from "./platform";
export * from "./bbl";
export * from "./parking";
export * from "./arshjul";
export * from "./driftslogg";
export * from "./units";
export * from "./avvik";
export * from "./kontrakter";
export * from "./dokumenter";
export * from "./vedlikehold";
export * from "./rutiner";
export * from "./maler";
export * from "./internkontroll";
export * from "./ai";
export * from "./vendors";
export * from "./tasks";
export * from "./hendelser";
export * from "./webhooks";
export * from "./leads";
export * from "./feedback";
export * from "./okonomi";
