# DriftIQ v2

Omskrivingen til Next.js + Better Auth. Kjører parallelt med v1 og deler ingenting med den
utover den sentrale Postgres-serveren.

**Status: fase 3 — tolv modulsider og seks detaljvisninger.** Backenden er komplett for kundemodulene. Gjenstår på frontend: dashbord, org-velger, innstillinger, brukere og admin-panelet. Det som finnes er
databaselaget, RLS-håndhevingen, autorisasjonsgatene, Better Auth med tofaktor, og
sikkerhetstestene (44 grønne). Det er med vilje: sikkerhetslaget skal stå og være grønt før
den første modulen flyttes, ikke etterpå.

| Miljø | App | Backend | Database |
|---|---|---|---|
| Prod (v1) | 3002 / 3003 | 8000 | `driftiq` |
| Test (v1) | 3005 / 3006 | 8001 | `driftiq_test` |
| **v2** | **3008** | i appen | **`driftiq_v2`** |

## Første gang

**1. Database og eierrolle** (én gang, krever superbruker på den sentrale Postgres-serveren):

```bash
docker exec -i postgres psql -U kristoffer -d postgres -v ON_ERROR_STOP=1 -c "CREATE ROLE driftiq_v2 LOGIN BYPASSRLS CREATEROLE PASSWORD 'BYTT_MEG'" -c "CREATE DATABASE driftiq_v2 OWNER driftiq_v2"
```

`BYPASSRLS` er ikke valgfritt. Eieren kjører migrasjoner, RLS-oppsett og alt som må lese på
tvers av kunder, og `FORCE ROW LEVEL SECURITY` gjelder også eieren — uten `BYPASSRLS` ville de
stedene sett en tom database, helt stille. Approllen `driftiq_v2_app` opprettes derimot
automatisk ved oppstart og skal *ikke* ha den.

**2. Miljøfil:**

```bash
cp .env.example .env
```

Fyll inn passordet fra steg 1, et nytt til approllen, og `openssl rand -hex 32` til Better Auth.

**3. Generer den første migrasjonen** (drizzle-kit skriver SQL fra skjemaet, og resultatet
sjekkes inn):

```bash
docker run --rm -v "$PWD:/app" -w /app node:22-alpine sh -c "npm install && npx drizzle-kit generate"
```

**4. Start:**

```bash
docker compose up -d --build
```

Merk `-p driftiq-v2`. Uten prosjektnavnet blir det `driftiq`, og du får et sett containere som
kolliderer med prod på porter — samme felle som er dokumentert for testmiljøet i CLAUDE.md.

## Kommandoer

```bash
# Sikkerhetstestene. Krever ekte Postgres og kjøres derfor i containeren, som v1-suiten.
docker compose exec app npm run test
```

```bash
# Typesjekk. Next-bygget alene beviser ikke at koden kan kjøre — samme lærdom som at
# `vite build` i v1 bygget grønt med en glemt import.
docker compose exec app npm run typecheck
```

## Hva som er annerledes fra v1, og hvorfor

**Ingen eksportert `db`.** Eneste vei til databasen er `withOrg(orgId, fn)` eller
`withoutRls(grunn, fn)`. v1 lot deg skrive en spørring uten org-kontekst, og fordi RLS feiler
*lukket* ble symptomet en tom liste uten feilmelding — den vanligste buggen i v1, dokumentert i
CLAUDE.md nettopp fordi verken typer eller tester fanget den. Her er den en kompileringsfeil.

**Unntakene fra RLS er en union-type, ikke en kommentar.** `withoutRls()` krever en `RlsUnntak`
— `"plattformpanel"`, `"leverandorportal"`, `"qr-anonym"`, `"innlogging"`, `"migrasjon"`,
`"bakgrunnsjobb"`. v1 hadde samme regel som prosa på importen av `get_db_uten_rls`. Den holdt,
men kunne ikke håndheves. Nå er lista over alt som omgår tenantisolasjonen komplett per
definisjon.

**Kryssende org-kontekst kastes.** Åpner du `withOrg("b")` inne i `withOrg("a")`, får du
`KryssendeOrgKontekst`. Én forespørsel skal aldri røre to borettslag i samme transaksjon, og
når det skjer er det nesten alltid en id som er ført videre feil.

**Manglende approlle stopper oppstart.** v1 falt tilbake til eierrollen med `[rls] ADVARSEL` og
`rls_aktiv: false` i plattformpanelet — en fornuftig avveining for et system som allerede sto i
produksjon. v2 har ingen slik arv og velger det strengere: er RLS ikke i kraft, starter vi ikke.

**Versjonerte migrasjoner.** v1 hadde hånd-rullet idempotent SQL i `_apply_migrations()`. Det
virket, men ga ingen historikk og ingen vei tilbake. Her genererer drizzle-kit SQL som sjekkes
inn. RLS-policyene settes fortsatt programmatisk, fordi de skal kunne endres for alle tabeller
samtidig.

## Hva som IKKE er portert

`src/db/schema/` inneholder bare `organizations`, `users`, `user_org_memberships`, `vendors`,
`tasks` og `task_checklist_items` — nok til å bevise isolasjonsmodellen i begge former (direkte
`org_id` og barnetabell via forelder).

`src/db/rls/tables.ts` bærer derimot **hele** tabellista fra v1 fra dag én. `settOpp()` hopper
over tabeller som ikke finnes ennå. Rekkefølgen er bevisst: sikkerhetsspesifikasjonen skal være
komplett før modulene kommer, ikke vokse etter dem.

Fra v1-suiten er `test_rls.py` portert. Disse gjenstår og hører til sine respektive faser:
`test_access_tier.py` og `test_support_session_utlop.py` (fase 1, sammen med Better Auth),
`test_ratelimit.py` (fase 1), `test_ai_samtale_isolasjon.py` og
`test_ai_tools_org_isolation.py` (fase 3, med AI-rådgiveren).

## Neste steg

1. Passkeys — en plugin til, nå som Better Auth står.
2. Fase 2 — første modul ende til ende. Parkering eller Årshjul, ikke Internkontroll.
3. Flere moduler, i samme mønster som Parkering. Se «Å porte en modul» under.

## Portert så langt

| Modul | Merknad |
|---|---|
| Parkering | komplett |
| Årshjul | komplett |
| Driftslogg | komplett |
| Enhetsregister | mangler bulk-import og adressesøk mot Kartverket |
| Oppgaver | mangler QR-bildegenerering, anonymt innsendingsskjema og bilder på utkvitteringer |
| Avvik | mangler vedlegg og koblingen til vernerunde (Internkontroll) |
| Kontrakter | komplett — første modul med filopplasting |
| Dokumentarkiv | komplett |
| Leverandører | mangler portalbruker og Unloc-nøkler |
| Vedlikehold | komplett |
| Rutiner | komplett |
| HMS-maler | komplett (plattformdata — `plattformRute`, ikke `orgRute`) |
| Internkontroll | mangler PDF-rapport fra vernerunde |
| AI-rådgiver | komplett |

Alle fire er dekket av migreringsskriptet.

## Frontend

Designsystemet ligger i `src/app/globals.css`, portert fra v1s `index.css`. Tre regler,
alle tre lært av feil i v1:

1. **Bruk tokenene, aldri px.** Seks trinn (`--fs-label` … `--fs-hero`); 12 er standard.
2. **Alt som må reagere på skjermbredde MÅ være en CSS-klasse.** Inline `style` kan ikke
   media queries — det var grunnen til at Internkontroll var ubrukelig på mobil. Bruk
   `.auto-grid` framfor et fast `repeat(N, 1fr)`.
3. **Skriv aldri et skriftnavn i en komponent.** `var(--font-sans)`. Skjemaelementer arver
   ikke font.

`src/lib/klient.ts` er eneste sted for API-kall — ingen `fetch` i sider eller komponenter.
Menypunktene ligger på modulen selv i `lib/moduler.ts`, så en modul ikke kan bli usynlig i
menyen slik den kunne i v1 (der `NAV` i Sidebar.jsx var en tredje liste).

```bash
docker compose exec app npm run lint
```

**Kjør denne — et grønt bygg er ikke bevis på at koden kan kjøre.** `no-undef` og
`rules-of-hooks` står som `error`; det er de to som faktisk ryker i produksjon. `next lint`
finnes ikke i Next 16, så oppsettet ligger i `eslint.config.mjs`.

## Fillagring

`src/lib/lagring.ts` eier opplasting og kvote. Lagrer modulen din filer, skal tabellen inn i
`FILTABELLER` — ellers teller ikke filene mot kvoten, og `lagring.test.ts` blir rød. Kvoten
er 5 GB som standard, overstyrbar per kunde via `organizations.storage_quota`.

Filer havner under `uploads/orgs/{orgId}/<modul>/` med uuid-navn; brukerens filnavn lagres
kun som visningsnavn og treffer aldri filsystemet.

## Å porte en modul

Fem steg, i denne rekkefølgen:

1. **Skjema** i `src/db/schema/<modul>.ts`, eksportert fra `index.ts`. Tabellen står som
   regel allerede i `DIREKTE_TABELLER` eller `BARNETABELLER` i `rls/tables.ts` — hele
   v1-lista kom inn i fase 0 — så policyen legges på av seg selv ved neste oppstart.
2. **Forretningsregler + Zod** i `src/lib/<modul>.ts`. Funksjonene tar `db` og `orgId`.
   Behold `.where(eq(x.orgId, orgId))` selv om RLS også ville stoppet det: to uavhengige
   lag som må svikte samtidig er hele poenget.
3. **Ruter** under `src/app/api/organizations/[orgId]/<modul>/`, bygget med `orgRute()`.
   Oppgi `nivaa` og `modul` — gatene kan ikke glemmes, de ligger i wrapperen.
4. **Nøkkelen** i `ALLE_MODULER` i `src/lib/moduler.ts` hvis modulen er ny.
5. **Tester** i `tests/<modul>.test.ts`. RLS-dekningen testes automatisk av `rls.test.ts`.

## Datamigrering fra v1

`scripts/migrer-fra-v1.ts` kopierer direkte fra v1s database. Idempotent, så den kan kjøres
om igjen rett før overgangen for å hente det som er kommet til.

```bash
DATABASE_URL_V1=postgresql://... npx tsx scripts/migrer-fra-v1.ts --torrkjor
```

Skriptet verifiserer til slutt at **hver eneste `tasks.qr_token` er uendret**. Det er den ene
sjekken som ikke kan hoppes over: QR-kodene er trykt på fysiske oppslag i bygget, og en
migrering som stille genererte nye tokens ville sett vellykket ut helt til noen skannet et.

### Filer

Skriptet kopierer **rader, ikke filer.** Kontraktdokumenter og andre vedlegg ligger på v1s
disk og må kopieres separat, inn i den nye org-først-strukturen:

```bash
rsync -a --info=progress2 v1:/sti/til/uploads/orgs/ ./uploads/orgs/
```

Filnavnene i basen er allerede uuid-baserte i begge versjoner, så filene beholder navn.
Radene peker på filer som ikke finnes før dette er gjort — nedlasting svarer da «Fil ikke
funnet på disk», som er ærlig, men ubrukelig for kunden.

Passordene flyttes fra `users.password_hash` til `account.password`. Formatet er identisk
(bcrypt/12), så brukerne logger inn med passordet de har. Brukere uten passord i v1 får ingen
account-rad og må gjennom «glemt passord» — som i v1.
