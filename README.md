# DriftIQ v2

Omskrivingen til Next.js + Better Auth. Kjører parallelt med v1 og deler ingenting med den
utover den sentrale Postgres-serveren.

**Status: fase 0 — fundament.** Ingen moduler er portert. Det som finnes er databaselaget,
RLS-håndhevingen og sikkerhetstestene. Det er med vilje: sikkerhetslaget skal stå og være
grønt før den første modulen flyttes, ikke etterpå.

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
cp .env.v2.example .env.v2
```

Fyll inn passordet fra steg 1, et nytt til approllen, og `openssl rand -hex 32` til Better Auth.

**3. Generer den første migrasjonen** (drizzle-kit skriver SQL fra skjemaet, og resultatet
sjekkes inn):

```bash
docker run --rm -v "$PWD/v2:/app" -w /app node:22-alpine sh -c "npm install && npx drizzle-kit generate"
```

**4. Start:**

```bash
docker compose -p driftiq-v2 --env-file .env.v2 -f docker-compose.v2.yaml up -d --build
```

Merk `-p driftiq-v2`. Uten prosjektnavnet blir det `driftiq`, og du får et sett containere som
kolliderer med prod på porter — samme felle som er dokumentert for testmiljøet i CLAUDE.md.

## Kommandoer

```bash
# Sikkerhetstestene. Krever ekte Postgres og kjøres derfor i containeren, som v1-suiten.
docker compose -p driftiq-v2 --env-file .env.v2 -f docker-compose.v2.yaml exec app npm run test
```

```bash
# Typesjekk. Next-bygget alene beviser ikke at koden kan kjøre — samme lærdom som at
# `vite build` i v1 bygget grønt med en glemt import.
docker compose -p driftiq-v2 --env-file .env.v2 -f docker-compose.v2.yaml exec app npm run typecheck
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

1. Fase 1 — Better Auth med JWT-plugin og JWKS, så v1s FastAPI kan validere de samme
   sesjonene mens den fortsatt lever. Bcrypt-hashene fra `users.password_hash` beholdes via
   custom hashing. 2FA og passkeys følger nesten gratis.
2. Fase 2 — første modul ende til ende. Parkering eller Årshjul, ikke Internkontroll.
