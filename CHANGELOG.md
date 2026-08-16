# DriftIQ — Endringslogg (intern)

Loggen starter ved 1.0.0. v2 er en omskriving, ikke en videreføring av v1s versjonsrekke:
v1 stoppet på 0.8.3, og v2 tar over nummeret ved første utgivelse fordi det er første gang
appen faktisk erstatter noe som var i bruk. v1s egen logg ligger i `~/stacks/driftiq`.

Kun **utgitt** arbeid får et nummer. Ligger endringen som en lokal commit, hører den ikke
hjemme her ennå.

---

## v1.0.0 – 2026-08-16

Første utgivelse av v2, og overtakelsen av testmiljøet: `test.driftiq.no` og
`test-admin.driftiq.no` peker nå på v2 (port 3008, databasen `driftiq_v2`), og v1s
testcontainere er slått av. Prod (`app.driftiq.no`) står urørt på v1 0.8.3.

### Én app i stedet for tre
- v1s React-frontend, admin-frontend og FastAPI-backend er erstattet av én Next.js-app som
  eier frontend, API og bakgrunnsjobber. Ingen delt kode med v1 utover passordhashene
  (bcrypt/12, så begge leser samme `account`-rader) og den sentrale Postgres-serveren
- Kundeapp, plattformpanel og landingsside skilles på vert (`VERT_APP`/`VERT_ADMIN`/
  `VERT_MARKED`) i `src/middleware.ts`. Vertsdelingen er dybdeforsvar — hver plattformrute
  krever plattformadmin på serveren uansett

### Tenantisolasjonen er flyttet fra disiplin til kompilator
- Ingen eksportert `db`. Eneste veier inn er `withOrg(orgId, fn)` og `withoutRls(grunn, fn)`,
  og `RlsUnntak` er en lukket union — ny bruk uten navngitt grunn kompilerer ikke. v1s
  vanligste bug (glemt org-filter → tom liste uten feilmelding) er nå en byggefeil
- Row Level Security på hver tenanttabell, med `src/db/rls/tables.ts` som register og en test
  som feiler hvis en ny tabell mangler dekning. Applikasjonsfiltrene beholdes i tillegg: to
  uavhengige lag som må svikte samtidig
- Nøstet `withOrg` mot en annen org kaster `KryssendeOrgKontekst` — én forespørsel kan ikke
  røre to borettslag

### Tilgang og innlogging
- Better Auth med selvbetjent tofaktor (TOTP + backup-koder) og JWKS på `/api/auth/jwks`, så
  v1s FastAPI kan validere v2-sesjoner i overgangsfasen
- Plattformadmin har ikke automatisk tilgang til kundedata: hver gate krever aktiv
  support-sesjon (maks 4 timer), og bruken logges i `support_access_log`
- Brukeren slås opp ferskt per forespørsel — en deaktivering biter umiddelbart, i motsetning
  til v1s sesjonssnapshot

### Moduler
- Portert fra v1: oppgaver med QR-kvittering, avvik, internkontroll (HMS), vedlikehold med
  arbeid i enkeltenheter, dokumentarkiv, kontrakter, leverandører, årshjul, driftslogg,
  enhetsregister, parkering og rutiner
- Nytt i v2: AI-rådgiveren (verktøyene eksponerer ingen org-parameter — tenantgrensen ligger
  i rutelaget, håndhevet av `tests/ai.test.ts`), «Meld feil» med innmeldingskø i panelet,
  leads-innboks, prisversjonering og systemhelse med jobbregister

### Migrering fra v1
- `scripts/migrer-fra-v1.ts` kopierer data direkte fra v1-basen, idempotent og med
  `--torrkjor`. `tasks.qr_token` kopieres uendret og **verifiseres** til slutt — tokenene
  henger som trykte oppslag i byggene
- `scripts/migrer-opplastinger.sh` flytter selve filene mellom uploads-volumene og oversetter
  v1s nøstede mapper til v2s flate struktur
- Generalprøven mot testmiljøet avdekket at `bbl`, `pricing_config`, `support_access_log` og
  `feedback_*` manglet i skriptet, og at `organizations` bare hadde med elleve kolonner —
  kontaktinfo, byggdata, kvoteoverstyring og BBL-tilknytning forsvant stille. Tettet før
  byttet; symptomet ville vært felter som så ut som «ikke fylt ut ennå»
