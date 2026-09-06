# Easee — ladeanlegget i parkeringsmodulen

*Designnotat, 06.09.2026. Bygget fra Easees API-dokumentasjon (developer.easee.com), ikke
fra v1 — v1 hadde ingen ladeintegrasjon. Første anlegg: kundens egen Easee-konto som site
owner. Partner/operatør-modellen er bevisst IKKE rørt før dette er testet mot en ekte lader.*

## Hva det gjør

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
| Skjema | `src/db/schema/easee.ts` (+ én linje i `index.ts`), `drizzle/0056_easee.sql` |
| RLS | tre tabellnavn i `DIREKTE_TABELLER` i `src/db/rls/tables.ts` |
| HTTP-adapter | `src/lib/easee.ts` (importfri — `opModeTekst` brukes av klienten) |
| Logikk | `src/lib/easeekobling.ts` |
| Ruter | `src/app/api/organizations/[orgId]/easee/**` |
| Klient | `easee`-blokken nederst i `src/lib/klient.ts` |
| UI | `src/app/(app)/innstillinger/EaseeKort.tsx`, `src/components/EaseeLading.tsx`, `.ea-`-blokken i `globals.css` |
| Tester | `tests/easee.test.ts` |
| Koblinger inn i resten | `<EaseeKort />` i Integrasjoner; `<EaseeLading />` er hele Lading-fanen i `parkering/page.tsx` (fanen viser plassene med ladepunkt uten kobling); `easee_settings` i `EKSKLUDERTE_TABELLER` i `lib/eksport.ts`; `kobleLaderTilPlass` setter `hasCharger`/`chargerLabel` på plassen (data, ikke skjema) |

Ingen egen modul (rutene gates med `modul: "parkering"`), ingen env-variabel, ingen
bakgrunnsjobb, ingen webhooks. Tokenene krypteres med samme nøkkel som Fiken-tokens
(`FIKEN_TOKEN_KEY` via `lib/kryptering.ts`). `parking_spots` har ingen kolonne som peker
på Easee — koblingen ligger i `easee_chargers.spot_id`.

### Slik fjernes den

1. Ny migrasjon som dropper `easee_charger_usage`, `easee_chargers` og `easee_settings`.
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

Ingen bakgrunnsjobb. `hentLading()` (GET på Lading-fanen) ringer Easee bare når det trengs:

| Hva | Når | Kall |
|---|---|---|
| Tilstand | eldre enn 30 s (`TILSTAND_HOLDBARHET_MS`) | 1 |
| Forbruk | eldre enn 6 t (`FORBRUK_HOLDBARHET_MS`) | 1 per lader |
| Laderlista | bare ved «Oppdater fra Easee» (POST) | 1 |

Svikter Easee, kommer fanen likevel med sist kjente tall, `feil` satt og `last_error`
notert på koblingen (vises på Integrasjoner-fanen). En lader som forsvinner fra anlegget
settes `active = false` — raden og forbruket beholdes, avregningen for forrige måned skal
ikke forsvinne fordi laderen ble byttet.

## Hvitelista — kun lesing

`TILLATTE_KALL` i `lib/easee.ts` er to POST-kall (innlogging, tokenfornying) og fem
GET-kall: profil, anlegg, anleggsdetalj, anleggstilstand, månedsforbruk. Ingen kommandoer
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
- **Ikke sett i praksis ennå:** tokenfornying (første token var fortsatt gyldig under
  testen) og hvor lenge refresh-tokenet lever. Testene dekker flyten mot stubb.

## Tilgang

| Handling | Nivå |
|---|---|
| Se status/kobling, se ladere, tilstand og forbruk | `lesing` (modulen parkering) |
| Koble lader til plass, «Oppdater fra Easee» | `redigering` |
| Koble til / fra, sette strømpris | `admin` — innloggingen gir innsyn i kundens ladeanlegg; prisen er avregningsgrunnlag |

Frakobling lar ladere, plasskoblinger og forbruk stå (historikk), men ingenting oppdateres.

## Beløp

Strømprisen lagres i **øre** per kWh (`easee_settings.price_per_kwh_ore`), som resten av
økonomimodulen; `tilOre`/`kroner` i `lib/okonomiregler.ts` gjør konverteringen. Beløpet i
avregningen er `round(kWh × øre)` per lader og vises med `kroner()`.

## Kandidater senere, hvis den blir stående

- Partner-/operatørmodellen (Easee «Operator»): nøkkel per DriftIQ, ikke per kunde, og
  laderne hentes på serienummer. Endrer koblingsskjemaet, ikke Lading-fanen.
- Avregningen som CSV/utskrift, og som utkast til faktura i økonomimodulen for avtaler
  med strøm «etter forbruk».
- Nattlig oppfrisking av forbruk og token (jobb i `instrumentation.ts`) i stedet for ved
  åpning — også så refresh-tokenet ikke rekker å dø mellom besøk.
- Zaptec med samme datamodell — `easee_chargers` blir da `chargers` med `provider`.
