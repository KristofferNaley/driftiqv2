# Easee — ladeanlegget i parkeringsmodulen

*Designnotat, 06.09.2026. Bygget fra Easees API-dokumentasjon (developer.easee.com), ikke
fra v1 — v1 hadde ingen ladeintegrasjon. Første anlegg: kundens egen Easee-konto som site
owner. Partner/operatør-modellen er bevisst IKKE rørt før dette er testet mot en ekte lader.*

## Hva det gjør

*Etappe 2 (06.09.2026): prisplaner og månedsrapport per plass og seksjon — se «Prisplan og
rapport» under. Etappe 3, fakturering fra Lading til Økonomi-fanen, er ikke bygget.*

Styret kobler ladeanlegget til én gang under **Innstillinger → Integrasjoner** med
brukernavn og passord for Easee-kontoen som er *site owner* for anlegget. Passordet brukes
én gang og lagres aldri (se «Auth»). Deretter viser **Parkering → Lading**:

- laderne i anlegget, med tilstand fra Easee (lader / ingen bil / frakoblet / feil …),
  effekt og kWh i pågående økt;
- hvilken parkeringsplass hver lader står på — det er DriftIQs bidrag; Easee vet ikke det —
  og dermed disponent og leieavtale (med hva avtalen sier om strøm);
- **månedsforbruk per lader og plass**, lagret i basen, med kroner hvis styret har satt en
  strømpris. Det er avregningsgrunnlaget for leieavtaler med strøm «etter forbruk».

Tilkobling, frakobling, strømpris og lader→plass går i hendelsesloggen.

## Hvorfor det er bygget som én fjernbar pakke

Samme grunn som Unloc: det er uklart hvor mange kunder som kan bruke det (kontoen må
være site owner; i mange anlegg er det installatøren eller et ladeselskap som er det),
og partner-modellen kan komme til å erstatte hele oppsettet. Alt skal derfor kunne
tas ut uten spor i resten av appen. Grensene:

| Del | Fil(er) |
|---|---|
| Skjema | `src/db/schema/easee.ts` (+ én linje i `index.ts`), `drizzle/0056_easee.sql`, `drizzle/0057_lading.sql` |
| RLS | seks tabellnavn i `DIREKTE_TABELLER` og `power_prices` i `UNNTATT` i `src/db/rls/tables.ts` |
| HTTP-adapter | `src/lib/easee.ts` (importfri — `opModeTekst` brukes av klienten), `src/lib/spotpris.ts` (hvakosterstrommen.no) |
| Regler | `src/lib/laderegler.ts` (importfri — prising, dag/natt, månedsgrenser; brukes av klienten også) |
| Logikk | `src/lib/easeekobling.ts` |
| Jobb | «easee-synk» i `lib/jobber.ts` + `instrumentation.ts` (nattlig, kl. 03:15) |
| Ruter | `src/app/api/organizations/[orgId]/easee/**` |
| Klient | `easee`-blokken nederst i `src/lib/klient.ts` |
| UI | `src/app/(app)/innstillinger/EaseeKort.tsx`, `src/components/EaseeLading.tsx`, `.ea-`-blokken i `globals.css` |
| Tester | `tests/easee.test.ts` |
| Koblinger inn i resten | `<EaseeKort />` i Integrasjoner; `<EaseeLading />` er hele Lading-fanen i `parkering/page.tsx` (fanen viser plassene med ladepunkt uten kobling); `easee_settings` i `EKSKLUDERTE_TABELLER` i `lib/eksport.ts`; `kobleLaderTilPlass` setter `hasCharger`/`chargerLabel` på plassen (data, ikke skjema); `parking_spots.unit_id` (plass → seksjon, brukes av rapporten, men hører til parkering og blir stående) |

Ingen egen modul (rutene gates med `modul: "parkering"`), ingen env-variabel, ingen
webhooks. Én bakgrunnsjobb («easee-synk», se under). Tokenene krypteres med samme nøkkel som Fiken-tokens
(`FIKEN_TOKEN_KEY` via `lib/kryptering.ts`). `parking_spots` har ingen kolonne som peker
på Easee — koblingen ligger i `easee_chargers.spot_id`.

### Slik fjernes den

1. Ny migrasjon som dropper `easee_charger_hours`, `easee_sessions`, `easee_price_plans`,
   `easee_charger_usage`, `easee_chargers`, `easee_settings` og `power_prices`.
   `parking_spots.unit_id` beholdes — plass → seksjon er nyttig uansett.
2. Slett filene i tabellen over; fjern de tre tabellnavnene fra `rls/tables.ts`, linja i
   `schema/index.ts`, `easee`-blokken i `klient.ts`, `.ea-`-blokken i `globals.css`,
   `easee_settings` i `eksport.ts`.
3. Fjern `<EaseeKort />` i Integrasjoner. Lading-fanen i `parkering/page.tsx` må få tilbake
   lista over plasser med ladepunkt (den ligger i «uten kobling»-grenen i `EaseeLading.tsx`).
4. `tests/rls.test.ts` er grønn igjen når tabellene er borte fra både base og register.

## Easee-modellen, kort

- **Konto** → **anlegg** («site», numerisk id) → **kurser** («circuits») → **ladere**
  (serienummer «EH…»). En site owner-konto når anleggene den eier.
- `GET /api/accounts/profile` brukes til å bekrefte innloggingen (og vise hvilken konto den
  hører til); `GET /api/sites` til å velge anlegg (automatisk ved ett, ellers navngir
  feilmeldingen kandidatene); `GET /api/sites/{id}?detailed=true` gir laderne per kurs.
- **Tilstand for hele anlegget i ett kall**: `GET /api/sites/{id}/state` gir
  `chargerState` (`chargerOpMode`, `isOnline`, `totalPower`, `sessionEnergy`,
  `lifetimeEnergy`) for alle laderne. Per-lader-endepunktene er ratebegrenset (økter: 10
  kall/time per lader; `GET /api/chargers`: 2/min) og brukes ikke.
- **Månedsforbruk**: `GET /api/chargers/lifetime-energy/{id}/monthly?from&to` gir én rad
  per måned med `consumption` (kWh, periodetall, 1-indeksert `month`). Hentes 13 måneder
  tilbake, med `to` = 1. i neste måned (se «Lært»), og lagres i `easee_charger_usage`
  (upsert på lader+år+måned). Inneværende måned oppdateres, gamle ligger fast.
- `chargerOpMode`: 0 offline, 1 ingen bil, 2 venter på start, 3 lader, 4 fullført, 5 feil,
  6 klar til lading, 7 venter på godkjenning, 8 avslutter. Etikettene er i `OP_MODE` i
  `lib/easee.ts`.

## Oppfrisking — når Easee ringes

`hentLading()` (GET på Lading-fanen) ringer Easee bare når det trengs:

| Hva | Når | Kall |
|---|---|---|
| Tilstand | eldre enn 30 s (`TILSTAND_HOLDBARHET_MS`) | 1 |
| Månedsforbruk | eldre enn 6 t (`FORBRUK_HOLDBARHET_MS`) | 1 per lader |
| Laderlista, timesforbruk, økter, spotpriser | bare ved «Oppdater fra Easee» (POST) og i jobben | 1 + 2 per lader |

**Jobben «easee-synk»** (kl. 03:15) gjør alt det siste for hver org med kobling:
`synkEasee()` → laderliste, tilstand, månedsforbruk, timesforbruk og økter fra siste
kjente time minus 48 t (`SYNK_OVERLAPP_TIMER`; Easee kan etterjustere), 92 dager tilbake
første gang (`SYNK_TILBAKEFYLL_DAGER`), og spotpriser for orgens områder. Nulltimer lagres
ikke. Økt-endepunktet tåler 10 kall/time per lader — derfor aldri ved visning. Feil per
org havner i `last_error` på koblingen (Integrasjoner-kortet) og i Discord-varselet.

Svikter Easee, kommer fanen likevel med sist kjente tall, `feil` satt og `last_error`
notert på koblingen (vises på Integrasjoner-fanen). En lader som forsvinner fra anlegget
settes `active = false` — raden og forbruket beholdes, avregningen for forrige måned skal
ikke forsvinne fordi laderen ble byttet.

## Prisplan og rapport

Reglene er `lib/laderegler.ts`; tallene er øre inkl. mva, som økonomimodulen.

- **Prisplan** (`easee_price_plans`, versjonert med `valid_from` — «Norgespris ut
  desember, spot fra januar» er to rader; måneden prises etter planen som gjaldt den 1.):
  - *Kraft*: `norgespris` (fast øre/kWh) eller `spot` (prisområde NO1–NO5, mva-prosent
    som påføres spotprisen — 0 i NO4 — og påslag i øre/kWh inkl. mva).
  - *Nettleie, energiledd*: dag- og nattsats, natt fra/til time (22–06), helg som natt.
  - *Fastledd*: øre per måned per lader som står på en plass. Kan være 0.
- **Timesforbruk** (`easee_charger_hours`) er grunnlaget — dag/natt og spot er per time.
  Måneden er Oslo-måneden (`maanedsgrenser`), så julitallet er 1.7 kl. 00 til 1.8 kl. 00
  norsk tid, ikke UTC. `easee_charger_usage` (månedstall fra Easee) brukes bare til
  oversikten «denne måneden» i laderlista.
- **Spotpriser** (`power_prices`): hvakosterstrommen.no, NOK/kWh uten mva, kvarter slått
  sammen til timer. Felles for alle orger (UNNTATT i RLS). En spottime uten pris prises
  IKKE som 0: rapporten teller dem, viser `*` på linja og varsler.
- **Rapporten** (`hentRapport`): per lader → plass → seksjon (`parking_spots.unit_id`) →
  nåværende eier (`unit_owners.owner_to IS NULL`): økter, kWh dag/natt, kraft, nett,
  fastledd, sum. Advarsler for manglende plan, spotpris, seksjon og plass. CSV
  (`eksporterRapport`, logges) og utskrift. Klikk på en linje viser øktene.
- **Plass → seksjon**: nytt felt på plassen (nedtrekk fra økonomimodulens seksjoner;
  `unitLabel` følger med som visningstekst). Det er dette som gjør at «plass G01 ladet
  97 kWh» kan bli «faktura til eieren av H0301» i etappe 3.

## Lading-fanen (etter Kristoffers mockup 06.09.2026)

Rekkefølgen er styrets prioritering: status først, penger etterpå, oppsett sjelden.

1. **Nøkkeltall for anlegget**: ladere (hvorav på nett), feil, forbruk denne måneden
   mot forrige, fakturerbart hittil (klare linjer), fakturagrunnlag klare av totalt.
   Parkeringssidens egen KPI-stripe skjules på denne fanen.
2. **Varsellinje** når fakturagrunnlaget for inneværende måned har linjer uten mottaker,
   med knapper rett til plassen eller til «Koble til plasser».
3. **Anlegget**: én rad per lader — navn og serienummer, plass, seksjon/disponent,
   tilstand i tre lag (på nett / bil tilkoblet / lader, med `reasonForNoCurrent` som
   forklaring), sist online (`latestPulse`), siste ladeøkt, kWh denne måneden. Feil og
   frakoblet sorteres alltid øverst. Radhandlinger: ⚠ oppretter et avvik med laderens
   navn, serienummer, plass og tilstand ferdig utfylt; › viser øktene. Plasskobling
   ligger bak «Koble til plasser» (engangsjobb).
4. **Forbruk siste 12 måneder** (stolper, natt nederst der timesdata og prisplan finnes)
   ved siden av **Trenger oppfølging**: feil, frakoblet, linjer uten mottaker, manglende
   prisplan — hver med knapp.
5. **Fakturagrunnlag** per måned: plass, seksjon/eier, lader, økter, kWh, energi
   (kraft + nett), fastledd, sum, status (klar / mangler seksjon / seksjon uten eier /
   uten plass). Klikk på raden viser øktene under den. Prisene som chips i headeren;
   «Priser» åpner skuffen; CSV og utskrift; «Send til Fiken» er deaktivert til etappe 3.

Easees `errorCode` vises som tall — kodelista står ikke i den offentlige
dokumentasjonen. `reasonForNoCurrent` er oversatt i `GRUNN_INGEN_STROM` i `lib/easee.ts`.

## Hvitelista — kun lesing

`TILLATTE_KALL` i `lib/easee.ts` er to POST-kall (innlogging, tokenfornying) og sju
GET-kall: profil, anlegg, anleggsdetalj, anleggstilstand, månedsforbruk, timesforbruk,
ladeøkter. Ingen kommandoer
(start/stopp/pause), ingen innstillinger, ingen strømgrenser, ingen planer, ingen sletting.
`tests/easee.test.ts` låser lista. Løftet til kunden: DriftIQ leser laderne, den styrer
dem aldri.

## Auth

Easee har ingen API-nøkler for site owner; den offentlige API-et bruker kontoens
brukernavn (e-post eller mobil med landkode) og passord:

- `POST /api/accounts/login` `{ userName, password }` → `accessToken` (gyldig `expiresIn`
  sekunder, 1 time) + `refreshToken`. Kalles én gang, i `kobleTil`. **Passordet lagres
  aldri** — det er kundens Easee-passord, og DriftIQ har ikke bruk for det etterpå.
- Tokenene lagres kryptert (`access_token_enc`, `refresh_token_enc`, `token_expires_at`).
  `medToken()` i `lib/easeekobling.ts` fornyer med `POST /api/accounts/refresh_token`
  `{ accessToken, refreshToken }` når det er under fem minutter igjen (`TOKEN_MARGIN_MS`),
  og én gang til hvis Easee svarer 401 midt i (tokenet kan ugyldiggjøres før utløp —
  dokumentasjonen sier «refresh if it expires or is invalidated»).
- Feiler fornyingen med 4xx, er innloggingen død. Fanen viser sist kjente tall med
  meldingen «Easee-innloggingen er utløpt — koble til på nytt», og Integrasjoner-kortet
  får rød status. Kontoadmin logger inn på nytt; ladere, plasskoblinger og forbruk står.
- Hvor lenge et refresh token lever hos Easee er ikke dokumentert. Går det ut mellom
  besøk, er det punktet over som fanger det. Blir det et problem i praksis, er en nattlig
  fornying (jobb i `instrumentation.ts`) svaret — ikke å lagre passordet.

Headeren lages ett sted: `autorisasjon()` i `lib/easee.ts` (`Authorization: Bearer`).

## Lært mot ekte Easee (06.09.2026, anlegget «Fjellstien», én Easee Home i garasje)

- **Innlogging med e-post + passord virker**, og `GET /api/sites` ga ett anlegg som ble
  valgt automatisk. Laderen kom med kursnavn («15 - Elbil») fra `panelName`.
- **`/api/sites/{id}/state`** svarer med `chargerState` som dokumentert: `chargerOpMode`,
  `isOnline`, `totalPower`, `sessionEnergy`, `lifetimeEnergy`, `latestPulse` — pluss
  `reasonForNoCurrent`, `errorCode`, `cableLocked`, `energyPerHour` og ~50 andre felt som
  kan brukes senere. `sessionEnergy` står igjen etter at bilen er koblet fra (viste 38,7
  kWh med `chargerOpMode` 1); UI-et viser den bare mens det lades (`opMode` 3).
- **Månedsforbruket stemmer med øktene.** `/lifetime-energy/{id}/monthly` ga 97,78 kWh
  for juli 2026; `/api/sessions/charger/{id}/sessions/{from}/{to}` ga tre økter i juli på
  til sammen 97,78. Månedene tidfestes i UTC («2026-07-01T00:00:00+00:00»).
- **Inneværende måned mangler når `to` = nå.** Med `to` = 6. september kom radene
  september 2025–august 2026, ingen september 2026; med `to` = 1. oktober kom september
  med. En måned telles bare når hele måneden ligger i perioden — derfor `forbrukTil()`
  (1. i neste måned, UTC). Dagstallene (`/daily`) har samme oppførsel og samme sum.
- Økt-objektet har også pris (`pricePerKwhExcludingVat`, `costIncludingVat`, `currency`)
  fra anleggets prismodell i Easee — en kandidat til å hente strømprisen derfra i stedet
  for å taste den i DriftIQ.
- **Timesforbruk tåler ~31 dager per kall**: 31 dager (744 timer) gikk, 45 ga 400 «Too
  many timeperiods in specified interval, try a smaller interval or larger aggregation
  type». Synken deler derfor perioden i vinduer på 28 dager (`SYNK_VINDU_DAGER`) — 92
  dagers tilbakefyll er fire kall per lader, og en vanlig natt er ett.
- **Øktlista gir bare avsluttede økter** («final charging sessions»); en pågående økt
  vises som tilstand («Lader», kWh i økten) på laderen og i timesforbruket, og kommer i
  lista når bilen kobles fra. Andre anlegg («Borettslaget Håsteinsgate 9», Easee Home
  EHDQZV55): to økter på 30 dager, 30,86 kWh siste, samsvarer med timesforbruket.
- **Ikke sett i praksis ennå:** tokenfornying (første token var fortsatt gyldig under
  testen) og hvor lenge refresh-tokenet lever. Testene dekker flyten mot stubb.

## Tilgang

| Handling | Nivå |
|---|---|
| Se status/kobling, se ladere, tilstand og forbruk | `lesing` (modulen parkering) |
| Se rapport, laste ned CSV, se prisplaner | `lesing` |
| Koble lader til plass, «Oppdater fra Easee» | `redigering` |
| Koble til / fra, prisplaner | `admin` — innloggingen gir innsyn i kundens ladeanlegg; prisene er fakturagrunnlag |

Frakobling lar ladere, plasskoblinger og forbruk stå (historikk), men ingenting oppdateres.

## Beløp

Alle priser er **øre** inkl. mva, som resten av økonomimodulen; `tilOre`/`kroner` i
`lib/okonomiregler.ts` gjør konverteringen. Kostnaden regnes per time (kWh × øre) og
rundes til hele øre per lader og måned (`beregnKostnad`).

## Etappe 3 — fakturering (ikke bygget)

Rapportlinjene har alt en faktura trenger: seksjon, eier (navn, e-post), beløp og måned.
Planen er en «ladekjøring» i Økonomi-fanen etter mønster av `fee_runs`/`fee_run_lines`:
kjøringen har `periodStart`/`periodEnd` som felleskostnadene, så **perioden er
sameiets valg** — måned, kvartal eller halvår (avklart 06.09.2026: månedlig er
standarden, men ikke alle vil ha tolv fakturaer). Én linje per seksjon per periode =
summen av månedsrapportene i perioden, `orderReference = lading:<unitId>:<fra>:<til>`,
CSV uten Fiken og fakturaer via Fiken-adapteret med kobling. **A-konto** er en egen
kjøringstype oppå dette: fast beløp per plass per måned (feltet finnes i prisplanen som
fastledd i dag; a-konto blir et eget felt), og en avregningskjøring per år som
fakturerer eller krediterer differansen mot rapporten. Rapporten per måned er
grunnlaget i alle variantene — den skal ikke endres for å støtte dem.

## Kandidater senere, hvis den blir stående

- **Flyten «plassen blir ledig»** (parkering): oppsigelse eller eierskifte → plassen
  ledig → veiviser som viser ventelisten og lar styret tildele i samme skjermbilde, med
  avtale, e-post og (senere) kontrakt. Laderen følger plassen, så rapporten bytter
  mottaker av seg selv. Nevnt av Kristoffer 06.09.2026: «enkelhet for styret».
  **Rekkefølgen på ventelisten er ikke gitt**: noen lag tildeler etter dato på lista,
  borettslag ofte etter ansiennitet (botid/andelsdato), og mange etter styrets skjønn
  med vedtak. Regelen må derfor være et valg per lag («dato på lista» / «ansiennitet» /
  «manuell rekkefølge») med mulighet til å overstyre med begrunnelse i loggen — ikke en
  sortering vi bestemmer. Ansiennitet krever innflyttingsdato på eier/andel
  (`unit_owners.owner_from` finnes for seksjonseiere).
- **Leieavtaler som dokumenter** (parkering, ikke Easee, men samme flyt for styret):
  avtalen opprettes i appen, genereres som PDF fra en mal, sendes leietakeren på e-post
  (`etterCommit`, via `lib/epost.ts`) og legges i dokumentarkivet med kobling til plassen.
  Signering er neste steg etter det. Nevnt av Kristoffer 06.09.2026.

- Partner-/operatørmodellen (Easee «Operator»): nøkkel per DriftIQ, ikke per kunde, og
  laderne hentes på serienummer. Endrer koblingsskjemaet, ikke Lading-fanen.
- Strømprisen fra Easees økt-objekt (`pricePerKwhExcludingVat`) som forslag i planen.
- Kapasitetsledd etter høyeste timeeffekt — timesforbruket finnes allerede.
- Zaptec med samme datamodell — `easee_chargers` blir da `chargers` med `provider`.
