/**
 * Tabellregisteret for Row Level Security — direkte port av `backend/app/rls.py` (BL-106).
 *
 * Listene her ER sikkerhetsspesifikasjonen. De holdes bevisst identiske med v1, felt for felt,
 * så lenge begge systemer lever: avviker de, isolerer v2 andre tabeller enn v1, og en modul
 * som flyttes over kan miste dekning uten at noen ser det. Endres v1, endres denne samtidig.
 *
 * Identifikatorene er norske (DIREKTE_TABELLER, BARNETABELLER, UNNTATT) i strid med den vanlige
 * regelen om engelske backend-navn. Det er med vilje: navnene er de samme som i rls.py, slik at
 * porten kan leses side om side med originalen.
 */

/**
 * Uttrykket som gir gjeldende org. `true` = missing_ok, altså NULL i stedet for feil når den
 * ikke er satt. Ingen kontekst skal gi null rader, ikke en 500.
 */
export const ORG = "current_setting('app.org_id', true)";

export const POLICY_NAVN = "tenant_isolasjon";

/**
 * Tabeller med egen org_id-kolonne — den enkle formen.
 *
 * Merk at `org_id` er VARCHAR i denne basen, ikke `uuid`. Derfor ingen `::uuid`-cast i
 * policyene, som ville feilet med «invalid input syntax».
 */
export const DIREKTE_TABELLER: readonly string[] = [
  "vendors", "vendor_contacts", "vendor_access_items", "vendor_notes",
  // Unloc (docs/unloc.md): kundens krypterte API-credentials og de digitale nøklene som er
  // delt ut. Sto lenge som en kommentar her («ikke bygget ennå») — nå finnes tabellene.
  // Fjernes integrasjonen, fjernes de her samtidig med migrasjonen som dropper dem.
  "unloc_settings", "vendor_unloc_keys",
  "tasks", "contracts",
  "deviations", "deviation_attachments",
  "completion_photos",
  "units",
  "hms_goals", "hazards", "hazard_actions", "safety_rounds", "safety_round_checklists",
  // Gjennomgangsprotokollene og øyeblikksbildene deres — begge har egen org_id.
  "risk_reviews", "risk_review_items",
  "hms_responsibilities", "hms_evaluations",
  "parking_spots", "parking_leases", "parking_waitlist",
  "annual_events", "log_entries",
  "document_folders", "documents",
  "routines", "routine_versions",
  "building_elements", "element_documents", "element_services",
  // Vedlikehold i enkeltenheter. Begge har egen org_id (som element_documents), så den
  // enkle formen holder — ingen EXISTS mot forelderen.
  "unit_works", "unit_work_documents",
  "ai_conversations", "ai_usage_daily",
  // Innmeldinger fra «Meld feil». Plattformpanelet leser dem på tvers via withoutRls,
  // men en kunde skal aldri kunne lese en annen kundes innmelding.
  "feedback_reports",
  // Hendelsesloggen (v2-tillegg, finnes ikke i v1s rls.py). Org-eid revisjonsdata —
  // en kunde skal aldri se en annen kundes hendelser.
  "audit_events",
  // Kundens webhooks (v2-tillegg). URL-ene kan avsløre interne kanalnavn og gir
  // skrivetilgang til kundens chat — en annen kunde skal aldri kunne lese eller endre dem.
  "org_webhooks",
  // Økonomimodulen (v2-tillegg, se docs/fiken.md). Alle har egen org_id — også
  // barnetabellene (budsjettlinjer, kjøringslinjer) fikk den med vilje, så isolasjonen
  // ikke avhenger av en EXISTS mot forelderen: eierregisteret er personopplysninger og
  // fakturaene er regnskap, begge mer sensitive enn resten av appen.
  "unit_owners", "budgets", "budget_lines", "unit_fee_rates",
  "fee_runs", "fee_run_lines", "supplier_invoices",
  // Regnskapskoblingen: krypterte tokens og speilede kjøp. En kunde skal aldri kunne lese
  // en annen kundes regnskap — heller ikke gjennom en glemt org-filter i en synkjobb.
  "fiken_connections", "fiken_purchases",
];

/**
 * Barnetabeller uten egen org_id — isoleres gjennom forelderen.
 *
 * Uten disse ville en glemt join sluppet ut f.eks. hele sjekklistehistorikken på tvers av
 * kunder, selv om `tasks` var beskyttet. `completion_checklist_results` må to hopp opp, siden
 * `completions` heller ikke har org_id.
 */
export const BARNETABELLER: Readonly<Record<string, string>> = {
  task_checklist_items:
    `EXISTS (SELECT 1 FROM tasks p WHERE p.id = task_checklist_items.task_id AND p.org_id = ${ORG})`,
  completions:
    `EXISTS (SELECT 1 FROM tasks p WHERE p.id = completions.task_id AND p.org_id = ${ORG})`,
  completion_checklist_results:
    "EXISTS (SELECT 1 FROM completions c JOIN tasks p ON p.id = c.task_id " +
    `WHERE c.id = completion_checklist_results.completion_id AND p.org_id = ${ORG})`,
  contract_price_history:
    `EXISTS (SELECT 1 FROM contracts p WHERE p.id = contract_price_history.contract_id AND p.org_id = ${ORG})`,
  deviation_logs:
    `EXISTS (SELECT 1 FROM deviations p WHERE p.id = deviation_logs.deviation_id AND p.org_id = ${ORG})`,
  deviation_treatments:
    `EXISTS (SELECT 1 FROM deviations p WHERE p.id = deviation_treatments.deviation_id AND p.org_id = ${ORG})`,
  hms_goal_approvals:
    `EXISTS (SELECT 1 FROM hms_goals p WHERE p.id = hms_goal_approvals.goal_id AND p.org_id = ${ORG})`,
  hms_sub_goals:
    `EXISTS (SELECT 1 FROM hms_goals p WHERE p.id = hms_sub_goals.goal_id AND p.org_id = ${ORG})`,
  safety_round_items:
    `EXISTS (SELECT 1 FROM safety_rounds p WHERE p.id = safety_round_items.round_id AND p.org_id = ${ORG})`,
  safety_round_participants:
    `EXISTS (SELECT 1 FROM safety_rounds p WHERE p.id = safety_round_participants.round_id AND p.org_id = ${ORG})`,
  safety_round_checklist_items:
    `EXISTS (SELECT 1 FROM safety_round_checklists p WHERE p.id = safety_round_checklist_items.checklist_id AND p.org_id = ${ORG})`,
  routine_steps:
    `EXISTS (SELECT 1 FROM routines p WHERE p.id = routine_steps.routine_id AND p.org_id = ${ORG})`,
  ai_messages:
    `EXISTS (SELECT 1 FROM ai_conversations p WHERE p.id = ai_messages.conversation_id AND p.org_id = ${ORG})`,
  feedback_messages:
    `EXISTS (SELECT 1 FROM feedback_reports p WHERE p.id = feedback_messages.report_id AND p.org_id = ${ORG})`,
};

/**
 * Tabeller som med vilje står UTENFOR RLS. Testen `ingen_tenanttabell_uten_dekning` leser
 * denne lista, så en ny tabell med org_id må enten få policy eller føres opp her med grunn.
 */
export const UNNTATT: Readonly<Record<string, string>> = {
  // Global identitet. Innlogging og brukeroppslag skjer FØR org er kjent — RLS her ville
  // gjort det umulig å logge inn. (`users.org_id` er en arv fra før multi-org og er nullbar.)
  users: "innlogging skjer før org-kontekst finnes",
  // Selve tilgangstabellen. Org-velgeren i sidemenyen må lese medlemskap på tvers av alle
  // org-ene brukeren tilhører, altså per definisjon utenfor én org-kontekst.
  user_org_memberships: "org-velgeren må lese medlemskap på tvers",
  // Org-metadata. Plattformpanelet og /organizations lister på tvers.
  organizations: "org-metadata, listes på tvers av plattformpanelet",
  // Plattformens egne tabeller — superadmin-only, aldri eksponert for kundebrukere.
  support_access_log: "plattformtabell, kun superadmin",
  // Leses også av abonnementssperren fra innloggingen, som ikke har org-kontekst.
  // En RLS-policy her ville gjort at sperren aldri fant kontraktene.
  platform_contracts: "plattformtabell (abonnement), superadmin + tilgangssperren i auth",
  // En lead har ingen org_id — den er nettopp noen som ENNÅ ikke er kunde. RLS har
  // ingenting å filtrere på, og tabellen er kun for plattformadmin.
  leads: "plattformtabell, ingen org_id å filtrere på",
  lead_activities: "barnetabell av leads, samme begrunnelse",
  // Saken hører til DriftIQs kø, ikke kundens — løpenummeret går på tvers av kunder.
  // Kunden ser bare sine egne via API-gaten, ikke via RLS.
  feedback_reports: "plattformtabell (DriftIQs sakskø)",
  feedback_messages: "barnetabell av feedback_reports, samme begrunnelse",
  // Globalt register over boligbyggelag. Har ingen org-eier — flere kunder kan være
  // tilknyttet samme lag, og registeret føres uavhengig av om noen kunde bruker laget.
  bbl: "globalt register over boligbyggelag, ingen org-eier",
  // Plattformens singleton-rad med satser og trappetrinn. Har ingen org_id i det hele tatt
  // — dette er DriftIQs egne priser, ikke noe som tilhører en kunde.
  pricing_config: "plattformens prismodell, singleton uten org_id",
  pricing_versions: "prismodellens versjonshistorikk, samme begrunnelse",
  // Kjøringslogg for bakgrunnsjobbene — plattformdata uten org_id, kun plattformpanelet leser.
  job_runs: "plattformtabell (kjøringslogg for bakgrunnsjobber), ingen org_id",

  // --- Nytt i v2 ---
  // Better Auth eier disse selv. De er global identitet på samme måte som `users`:
  // sesjonsoppslag skjer før org er kjent, og en RLS-policy ville gjort innlogging umulig.
  // Isolasjonen her er at ingen av dem inneholder kundedata — bare identitet og sesjon.
  session: "Better Auth: sesjonsoppslag skjer før org-kontekst finnes",
  account: "Better Auth: innloggingsmetoder knyttet til global bruker",
  verification: "Better Auth: engangstokens, slås opp uten org-kontekst",
  jwks: "Better Auth: nøkkelpar for JWT-signering, ingen kundedata",
  two_factor: "Better Auth: TOTP-hemmelighet, verifiseres før org-kontekst finnes",
  // Innloggingshendelser er brukernivå, ikke org-eid — en bruker i to lag skal ikke få
  // innloggingene sine eksponert for begge styrene. Leses kun av plattformpanelet.
  auth_events: "innloggingslogg på brukernivå, skrives før org-kontekst finnes",
};

/**
 * RLS gjør barnetabellenes EXISTS-subspørring til noe som kjøres ved hver radtilgang. Uten
 * indeks på fremmednøkkelen blir det en seq scan per rad.
 */
export const FK_INDEKSER: readonly string[] = [
  "CREATE INDEX IF NOT EXISTS idx_contract_price_history_c ON contract_price_history(contract_id)",
  "CREATE INDEX IF NOT EXISTS idx_hms_goal_approvals_goal  ON hms_goal_approvals(goal_id)",
  "CREATE INDEX IF NOT EXISTS idx_hms_sub_goals_goal       ON hms_sub_goals(goal_id)",
  "CREATE INDEX IF NOT EXISTS idx_safety_round_items_round ON safety_round_items(round_id)",
  "CREATE INDEX IF NOT EXISTS idx_safety_round_part_round  ON safety_round_participants(round_id)",
  "CREATE INDEX IF NOT EXISTS idx_sr_checklist_items_liste ON safety_round_checklist_items(checklist_id)",
  "CREATE INDEX IF NOT EXISTS idx_routine_steps_routine    ON routine_steps(routine_id)",
  "CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation ON ai_messages(conversation_id)",
  "CREATE INDEX IF NOT EXISTS idx_feedback_messages_report ON feedback_messages(report_id)",
  "CREATE INDEX IF NOT EXISTS idx_deviation_treatments_dev ON deviation_treatments(deviation_id)",
];

const LOVLIG_NAVN = /^[a-z_][a-z0-9_]*$/;

/**
 * Tabellnavnene her er hardkodet, men de settes inn i SQL som ikke kan parameteriseres.
 * Bedre å bryte høylytt enn å la en fremtidig redigering bli en injeksjonsvei.
 */
export function sikkertNavn(navn: string): string {
  if (!LOVLIG_NAVN.test(navn)) {
    throw new Error(`Ugyldig tabellnavn i RLS-oppsettet: ${JSON.stringify(navn)}`);
  }
  return navn;
}
