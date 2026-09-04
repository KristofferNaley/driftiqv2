# CLAUDE.md

Arbeidsnotater for Claude Code i dette repoet — **DriftIQ v2** (Next.js 16 + Drizzle +
Better Auth). `README.md` dekker stack, oppsett, deploy og *hvorfor* arkitekturen er som den
er — her står det som ikke er åpenbart fra koden, og det som er lett å gjøre feil.

**v2 er produksjon siden 25.08.2026** (`app.driftiq.no`, `admin.driftiq.no`, `driftiq.no`).
v1 (FastAPI + React) er tatt ned, og v1-repoet ligger ikke lenger på VPS-en
(`~/stacks/driftiq` finnes ikke). Det uporterte (leverandørportalen, modulkatalogen — se
README «Hva som IKKE er portert») må derfor bygges fra designnotatene i `docs/`, ikke fra
v1-koden. v1 og v2 delte aldri noe utover den sentrale Postgres-serveren (og passordhashene,
se «Auth»).

## Språk

Alt er **norsk**: UI-tekst, `detail`-meldinger fra API-et, commit-meldinger, kommentarer —
og i v2 også kodeidentifikatorer (`orgRute`, `krevOrgAdmin`, `hentOppgaver`, `lib/avvik.ts`).
Unntaket er databasen: tabell- og kolonnenavn er engelske (`tasks`, `org_id`) fordi
migreringen fra v1 kopierer 1:1. Følg mønsteret i filen du er i.

## Kommandoer og verifisering

**Det er ikke installert Node på verten.** Alt kjøres i Docker — enten i appcontaineren
eller i en engangscontainer med `node:22-alpine`.

**Containeren har ingen kildemount.** Koden i den er et snapshot fra forrige image-bygg, så
`docker compose exec app npm run typecheck` svarer grønt på endringer den aldri har sett —
feilen er stille i begge retninger (påvist 09.08.2026: typecheck, lint og hele testsuiten
«grønne» mot en dag gammel kopi). Verifiser derfor mot verten i en engangscontainer:

```bash
# Typesjekk + lint av det som faktisk ligger på disk. Et grønt Next-bygg er ikke bevis på
# at koden kan kjøre — linten har fire ganger på rad fanget noe bygget slapp gjennom.
docker run --rm -v "$PWD:/app" -w /app node:22-alpine sh -c "npx tsc --noEmit && npx eslint ."
```

```bash
# Testsuiten (vitest, 400+ tester). Krever ekte Postgres og kjøres derfor i containeren —
# men FØRST etter --build, ellers tester du forrige image.
docker compose up -d --build && docker compose exec app npm run test
```

- `next lint` finnes ikke i Next 16 — oppsettet ligger i `eslint.config.mjs`, skrevet for å
  fange nøyaktig det bygget ikke fanger: `no-undef` og `rules-of-hooks` som `error`,
  DOM-globalene (`MouseEvent`, `HTMLInputElement`, `navigator`, …) listet eksplisitt.
- Appen kjører på **3008**, bundet til localhost — Cloudflare-tunnelen når containeren via
  `edge`-nettet. **Dette er produksjon.** Databasen er `driftiq_v2` på den sentrale
  Postgres 18-serveren (verten «postgres» på `edge`-nettet) — ikke en del av stacken.
- **Testmiljøet (siden 03.09.2026)** er en egen klone i `/root/driftiqv2-test` på samme
  vert: compose-prosjekt `driftiqv2-test`, port 3009, egen base `driftiq_v2_test` med egen
  approlle, vertene `test.driftiq.no`/`test-admin.driftiq.no`, domenevakt PÅ. Port og
  minnetak ligger i en usporet `docker-compose.override.yaml`. **Alt kodearbeid skjer der**;
  prod-klonen `/root/driftiqv2` får bare `git pull` + `--build`, og en hook der avviser
  redigering. `CLAUDE.local.md` i hver klone sier hvilken du står i. Testbasen inneholder
  **kun de to «DEMO - »-organisasjonene** — den ble seedet fra en prod-dump (restore-test)
  og deretter vasket for kundedata samme dag. Seedes den fra prod igjen, må tre ting gjøres
  etterpå: vask bort alt som ikke er demo, slett `jwks`-raden (kryptert med prods
  `BETTER_AUTH_SECRET`; ellers velter API-laget med «Failed to decrypt private key»), og
  sett `org_webhooks.active = false` — kundenes Teams/Discord-webhooks har ingen miljøvakt
  slik e-posten har, og varselsjobben ville postet testvarsler i kundens kanal. En vakt i
  `lib/webhooks.ts` etter mønster av `EPOST_TILLATTE_DOMENER` er riktig varig løsning, og
  et seed-skript (`scripts/seed-test.ts`) er riktig erstatning for dump-seeding.
- `docker compose up -d --build` — deploy krever alltid `--build`; standalone-bygget bakes
  inn i imaget, og et `git pull` alene endrer ingenting for det som kjører.
- E-postoppsettet verifiseres med `scripts/test-epost.ts` (sjekker nøkkel, avsender og
  domenevakt i ett kall — se toppen av fila for kjørekommandoen).

### Tester

Testene kjører mot **samme database som appen de kjøres i**. Kjør dem i testmiljøet
(`docker compose -p driftiqv2-test exec app npm run test` i `/root/driftiqv2-test`), aldri i
prod-klonen — der er basen produksjonsbasen, og en test som feiler midt i `afterEach`
etterlater sine egne rader hos kundene. Testbasen er en kopi av prod, så regelen under om
å aldri røre rader testen ikke selv har opprettet gjelder der også.
Derfor `fileParallelism: false` i `vitest.config.ts`: filene rydder med `DELETE` og ville
sett hverandres data parallelt. Ingenting hoppes over uten DB; uten `DATABASE_URL` krasjer
alt.

Konvensjon for en ny testfil (se `tests/avvik.test.ts` som mal):

1. Blokkommentar øverst: hvilken v1-testfil dette er port av, og tyngdepunktet.
2. Test **lib-funksjonene direkte** (`src/lib/<modul>.ts`). API-laget testes kun i
   `tests/api.test.ts`, som importerer de ekte rutehandlerne via `@`-aliaset.
3. `eierPool` (skjemaeier, BYPASSRLS) til oppsett/opprydding; `withOrg()` for det som testes
   — gatene må kalles gjennom `withOrg` slik et endepunkt gjør det.
4. `afterEach` som `DELETE`r i FK-riktig rekkefølge; `afterAll` med `lukkPooler()`.
5. **En test skal aldri endre rader den ikke har opprettet selv.** Et tidlig utkast
   degraderte en ekte konto med `UPDATE users SET role='member' WHERE role='superadmin'`.

### UI-testing

- Testbruker i kunde-appen (kun testmiljøet): `agent@driftiq.no`, orgadmin i «DEMO - Sammen
  Sameie» og «DEMO - Det Beste Borettslaget». Passordet ligger i
  `/root/driftiqv2-test/.agent-bruker.txt` (utenfor git). Adressen er ekte og slipper
  gjennom domenevakten, så e-post fra test kan leses.
- **Plattformpanelet kan ikke UI-testes av en agent.** Begge plattformadmin-kontoene er
  ekte brukere, og en agent skriver ikke passord inn i innloggingsfelt — og skal heller
  ikke heve rollen til en testbruker for å komme rundt det. Panelet dekkes av
  `tests/plattform.test.ts` og `tests/kundedetalj.test.ts`; UI-et klikkes gjennom manuelt.
- **Å faktisk bruke appen finner det alle de andre lagene slipper gjennom.** To ganger på
  rad fant et klikk gjennom appen feil verken bygg, typecheck, lint eller testene så
  (`BETTER_AUTH_TRUSTED_ORIGINS`-403-en; liste og detalj med ulike joins). Foreslå en
  klikkerunde etter større endringer.

## Arkitektur — det som må følges

### Databasetilgang

**Ingen eksportert `db`.** Eneste veier inn er `withOrg(orgId, fn)` og
`withoutRls(grunn, fn)` i `src/db/client.ts`. RLS feiler *lukket*, så symptomet på glemt
org-kontekst er en tom liste uten feilmelding — v1s vanligste bug. Her er den en
kompileringsfeil i stedet.

- `RlsUnntak` er en lukket union (`"plattformpanel" | "leverandorportal" | "qr-anonym" |
  "innlogging" | "migrasjon" | "bakgrunnsjobb"`). Ny bruk uten navngitt grunn kompilerer ikke.
- Nøstet `withOrg` mot en **annen** org kaster `KryssendeOrgKontekst` — én forespørsel skal
  aldri røre to borettslag i samme transaksjon.
- **Applikasjonsfiltrene beholdes likevel**: `.where(eq(x.orgId, orgId))` skal stå i hver
  spørring selv om RLS også ville stoppet det. To uavhengige lag som må svikte samtidig er
  hele poenget.
- To pooler: `adminPool` (eier, BYPASSRLS — migrasjoner/plattform/jobber) og `appPool`
  (`driftiq_v2_app`, underlagt policyene). `APP_DB_PASSWORD` er **påkrevd** — appen nekter
  å starte uten (bevisst strengere enn v1s advarsel-og-fallback).
- `id` og `org_id` er **varchar**, ikke `uuid` — en `::uuid`-cast i en policy feiler.

**Ny tabell:** skjemafil i `src/db/schema/`, eksportert fra `index.ts` (barrel), og inn i
`src/db/rls/tables.ts` — `DIREKTE_TABELLER` (egen `org_id`), `BARNETABELLER` (EXISTS mot
forelder, og da også `FK_INDEKSER`), eller `UNNTATT` med skriftlig grunn.
`tests/rls.test.ts` («ingen tenanttabell uten dekning») feiler hvis du glemmer det.
Policyene settes idempotent ved hver oppstart av `scripts/oppstart.ts` — rekkefølgen
migrasjoner → `settOpp()` → `verifiserRoller()` er ikke valgfri. Migrasjoner genereres med
`npm run db:generate` og **sjekkes inn** i `drizzle/`.

### API-ruter

Ingen rutehandler skrives for hånd — en `route.ts` er 3–6 linjer med
`orgRute({ nivaa, modul, handler })` fra `src/lib/api.ts`. Wrapperen gjør sesjon →
`withOrg` → nivågate → modulgate → handler, så gatene kan ikke glemmes. Men:

- **`modul` er valgfri i typen.** En ny modulrute kompilerer fint uten — og er da åpen for
  kunder som ikke har modulen. Bare org-metadata/brukerliste skal utelate den.
- Modulsjekken kjører **etter** tilgangsgaten med vilje (403-meldingen skal ikke røpe
  modulstatus til utenforstående). Ikke bytt om.
- Feilformat er alltid `{ "detail": "<norsk melding>" }` — kast `ApiFeil(status, melding)`
  eller hjelperne `ikkeFunnet()`/`ugyldig()`. Kroppsvalidering med `lesKropp(req, zodSkjema)`;
  Zod-skjemaet bor i samme `src/lib/<modul>.ts` som forretningslogikken.
- **Utadrettede sidevirkninger skal i `etterCommit(() => …)`.** Skrivinger er usynlige for
  andre tilkoblinger før commit: en invitasjon sendte «User not found» fordi Better Auth
  slo opp adressen på egen tilkobling midt i transaksjonen — bruker opprettet, e-post aldri
  sendt. Gjelder all e-post, webhooks og tredjeparts-API.
- Filnedlasting returnerer `Filsvar` — en rå `Buffer` blir ellers JSON-kodet til
  `{"type":"Buffer",…}` (skjedde med alle tre nedlastingene samtidig).
- `plattformRute` kjører i `withoutRls("plattformpanel")` uten org-kontekst — rører den en
  org-eid tabell, er det en stille tenantlekkasje.
- Anonyme QR-ruter (`src/app/api/qr/`) bruker ingen wrapper, men **må** gå gjennom
  `tilSvar(e)` for samme feilform.

### Tilgang

- **Plattformadmin har ikke automatisk tilgang til kundedata** — hver gate i
  `src/lib/tilgang.ts` krever aktiv support-sesjon (maks 4 timer). Et vanlig medlemskap i
  en org gir dem heller ingenting; rollen sjekkes først.
- Rolleverdien i databasen heter fortsatt **`superadmin`**; ordet i UI og kode er
  «plattformadmin». Ingen nye strengsammenligninger — bruk `erPlattformadmin()` fra
  `src/lib/nivaer.ts`.
- Nivåverdiene er `orgadmin`/`redigering`/`visning`; «Kontoadmin» er bare etikett
  (`NIVA_ETIKETT`). Medlemskapets *tittel* styrer ingenting.
- Brukeren slås opp **ferskt** per forespørsel (`hentBruker`), aldri fra sesjonskopien —
  en deaktivering biter umiddelbart.

### Auth (Better Auth)

- Passord hashes med **bcrypt/12** — samme format som v1, så de migrerte hashene leses
  uendret. Endres rundene, låses alle migrerte brukere ute til de bytter passord.
- `disableSignUp: true` — brukere opprettes av orgadmin. `additionalFields` `role`/`active`
  har `input: false`; uten det kunne et profilkall sendt `role: "superadmin"`.
- **`BETTER_AUTH_TRUSTED_ORIGINS`**: uten den svarer innlogging 403 `INVALID_ORIGIN` fra
  alle andre verter enn `BETTER_AUTH_URL` — og verken bygg, lint eller tester ser det,
  heller ikke curl mot localhost (localhost ER baseURL). Hver `VERT_*` må stå der.
- `authDb` er `withoutRls("innlogging")` materialisert — trygt kun fordi Better Auth bare
  rører `UNNTATT`-tabeller. Legg aldri en org-eid tabell i auth-skjemaet.
- JWT-plugin med JWKS på `/api/auth/jwks` ble lagt inn for at v1s FastAPI skulle validere
  v2-sesjoner i overgangen. v1 er nede, og ingenting annet i v2 bruker den (sjekket
  01.09.2026) — kandidat for fjerning, sammen med `jwks`-tabellen.

### Registerfiler — mønsteret bak

Der svikt er *stille*, ligger regelen som en importfri registerfil som både kjøretid og
tester leser. Glemmer du oppføringen, blir en **test** rød — ikke en kunde:

| Register | Fil | Testen som fanger glipp |
|---|---|---|
| RLS-dekning | `src/db/rls/tables.ts` | `tests/rls.test.ts` |
| Filtabeller (kvote) | `FILTABELLER` i `src/lib/lagring.ts` | `tests/lagring.test.ts` |
| Moduler + meny | `src/lib/moduler.ts` | — (men én fil, ikke tre som i v1) |
| AI-verktøy uten org-parameter | `src/lib/ai-verktoy.ts` | `tests/ai.test.ts` |

**Ny modul:** nøkkel i `ALLE_MODULER` **og** menypunkt i `MENY` (ellers usynlig — ikonet er
et lucide-navn som *streng*, så fila er React-fri), vurder `AV_SOM_STANDARD`, og `modul:` i
alle rutene. Omdøpes en nøkkel, må `GAMLE_ALIASER` få en oppføring — ellers låses kunder
med eksplisitt lagret modulliste ute.

### Fillagring

- `src/lib/lagring.ts` eier alt: type → størrelse → kvote → disk, i den rekkefølgen.
  Filnavn på disk er alltid `randomUUID()` + endelse fra `TILLATTE_TYPER`; brukerens
  filnavn er kun visningsnavn. Struktur: `uploads/orgs/{orgId}/<modul>/`.
- Lagrer modulen din filer: tabellen inn i `FILTABELLER`, ellers teller ikke filene mot
  kvoten (5 GB standard, `organizations.storageQuota` overstyrer).
- **`/* turbopackIgnore: true */`-kommentarene må stå INNE i kallene** (`mkdir`,
  `writeFile`, `path.join`, …). Uten dem kan ikke traceren avgjøre stiene statisk og tar
  med HELE prosjektet i serverbundlet.
- Uploads er et navngitt Docker-volum — filene overlever `--build`, men er ikke i repoet.

### Historikk og aktør

`Aktor` i `src/lib/aktor.ts`: `{ navn, brukerId }` — **begge, alltid**. Navnet kopieres inn
i raden (protokollen skal lese likt om ti år, også etter navnebytte eller slettet konto);
`brukerId` er søkenøkkelen («hva har jeg gjort»). `brukerId: null` er en gyldig tilstand
(QR-flyten er anonym), ikke en mangel. Sjekklistepunkter følger samme tanke: uendret tekst
beholder id-en, et omdøpt punkt er et NYTT punkt.

**Hendelsesloggen** (`audit_events`, `lib/hendelser.ts`): mutasjoner med revisjonsverdi —
tilgangsendringer, sletting, eksport, nøkler, tildelinger — logges med `loggHendelse(db, …)`
fra lib-funksjonen, i SAMME transaksjon som handlingen. Aldri lesing (unntak: eksport).
`event`-teksten er norsk fritekst i fortid; maskinsiden bæres av `module`/`entity`.
Innlogging går til `auth_events` (brukernivå, UNNTATT, feiler stille) via krokene i auth.ts.
Oppbevaring håndheves av jobben «hendelsesrydding» — grensene er konstanter i hendelser.ts.

### E-post

- Alt utgående går gjennom `src/lib/epost.ts` (`ramme()`-malen — tabell-HTML for Outlook,
  systemfont for Gmail). Ny e-posttype legges der, ikke i modulkoden.
- **Resends SDK kaster ikke ved API-feil** — den returnerer `{ error }`. Uten sjekken ser
  en avvist sending (typisk uverifisert avsenderdomene) ut som en vellykket.
- Tom `RESEND_API_KEY` = ingenting sendes, alt går videre — et manglende varsel skal aldri
  velte en handling brukeren utførte.
- **Domenevakten (`EPOST_TILLATTE_DOMENER`)** er AV når variabelen ikke er satt, med vilje:
  prod skal ikke avhenge av at noen husker den. Settes det opp et testmiljø med kopi av
  prod-basen igjen, skal den PÅ der — basen har ekte, leverbare adresser.
- Send aldri fra en handler direkte — `etterCommit`.

### Bakgrunnsjobber

`src/instrumentation.ts` er Next sitt eneste oppstartspunkt. Nye jobber må arve begge
gatene der: `NEXT_RUNTIME === "nodejs"` og hopp over byggefasen (ellers kobler `next build`
til databasen og henger). Cron-uttrykk med `{ timezone: "Europe/Oslo" }` — containeren
kjører UTC. `kjorVarsler(naa)` tar tidspunktet som argument for testbarhet; bruk `naa`, ikke
`new Date()`. **Det finnes ingen dobbeltkjøringsvern** — jobbene hviler på at det kjører én
instans; skaleres det, må jobben ut eller ta en DB-lås. Forsinkelsesregelen er samme
funksjon som skjermen bruker: `erForsinket` i `src/lib/oppgaveregler.ts` — v1 hadde sju
kopier som drev fra hverandre; ikke lag kopi nummer to.

### AI-rådgiveren

Tenantisolasjonen ligger i at `orgId` bindes i rutelaget og at **ingen verktøyskjemaer
eksponerer en org-parameter** — sender modellen en, ignoreres den. `tests/ai.test.ts`
håndhever begge deler; nye verktøy må filtrere på `orgId` og få krysstest der. Dokumenter
leses kun med `aiReadable` satt på raden (opt-in per dokument). Samtaler er private per
bruker — også i support-modus. Modellens svar formatteres som React-noder, aldri
`dangerouslySetInnerHTML`: systemprompten ber om ren tekst, men «en prompt er en bønn,
ikke en garanti».

### Server/klient-grensen

`server-only`-pakken ble prøvd og **tatt ut** (den velter oppstartsskript, migrering og
testsuite — begrunnelse i `src/db/client.ts`). Regelen håndheves i stedet slik: alt
klientkomponenter trenger, ligger i **importfrie filer** — `nivaer.ts`,
`oppgaveregler.ts`, `varselvalg.ts`, `avvikkategorier.ts`, `feilmeldingtyper.ts`,
`orgnr.ts`, `brreg.ts`, `aktor.ts`, `urler.ts`. Ikke gi dem server-importer: verken tsc
eller lint ser bruddet, symptomet er `Can't resolve 'dns'` i bygget.

## Frontend

Designsystemet er `src/app/globals.css` — én fil, ingen Tailwind/CSS-moduler. Tre regler
fra toppkommentaren, alle lært av feil i v1:

1. **Bruk tokenene, aldri px.** Seks trinn: `--fs-label` (12, **standard** — `body` har
   den), `--fs-sm` 14, `--fs-md` 16, `--fs-lg` 20, `--fs-xl` 26, `--fs-hero` 40. Innhold
   skal ikke være større enn overskriften over seg.
2. **Alt som reagerer på skjermbredde MÅ være en CSS-klasse.** Inline `style` kan ikke
   media queries — det gjorde Internkontroll ubrukelig på mobil i v1. Foretrekk
   `repeat(auto-fit, minmax(Npx, 1fr))` (`.auto-grid`) framfor egne breakpoints.
3. **Aldri skriftnavn i en komponent** — `var(--font-sans)`. Fonten importeres ett sted
   (`src/app/layout.tsx`, selvhostet @fontsource — ikke Google-CDN, det ville sendt
   beboernes IP til en tredjepart). `button`/`input`/`select`/`textarea` arver ikke font.

Tema: `data-theme` på `<html>`, satt av inline-skript i `layout.tsx` før første maling
(mørkt er standard). Gjennomsiktige aksentflater skrives `rgba(var(--accent-rgb), …)`.
`Temaknapp.tsx` (app/plattform) og `(marked)/temaveksler.tsx` er to nesten like
komponenter — endres logikken, må begge med.

### Gjenbruk før nybygg

- **Byggeklosser:** `Modal`, `Skuff` (høyreskuff for én rad mens lista står),
  `Fanemodal` (vertikale faner i modal), felter og `useSending` i
  `src/components/skjema.tsx`; `Kort`, `Rad`, `Tom`, `Feil`, `Hurtigskjema`, `Faner`
  (horisontal fanerad til `subnav`) og formateringsfunksjonene i `felles.tsx`. En egen
  modal mister Esc/klikk-utenfor; egen datohenting mister omlasting ved orgbytte.
- **`useOrgData<T>(hent, avhengigheter)`** er standard datahenting per org — den eier
  `orgId`-avhengigheten selv.
- **`src/lib/klient.ts` er eneste sted for API-kall** — ingen `fetch` i sider/komponenter
  (unntak: de offentlige QR-sidene, som er utenfor sesjon). Nye endepunkter får typedef og
  legges i modulobjektene (`oppgaver.hent(…)`), ikke som håndskrevne stier. 401 håndteres
  sentralt; feilmeldinger er alltid norske via `{ detail }`.
- Detaljvisninger er i økende grad **fanemodal over lista** (`?apen=<id>`), ikke egen side
  — `/leverandorer/[id]` og `/kontrakter/[id]` er rene redirects dit.
- Sider bruker `<Layout tittel …>` med `<div className="page-content">` som ytterste
  element — det er den som har scroll, maks-bredde (`--content-max`) og gap.
- **Kun valget av org ligger i `localStorage`** (`aktivOrgId`). Nivå, moduler og tilgang
  kommer alltid ferske fra `/api/meg` via `useOkt()` — v1s snapshot-bug (lesevisning uten
  forklaring) er bevisst umuliggjort. Ikke cache orgobjektet i egen state.

### CSS-feller som har truffet

- `<button>` arver verken `color` eller `font-family` — `background: none` uten
  `color: inherit` ga svart tekst på mørk bakgrunn **tre ganger** før mønsteret satt.
- Grid-kolonner har `min-width: auto` — uknuselig innhold presser naboene ut; bruk
  `minmax(0, 1fr)`/`min-width: 0` (se `.bruker-rad`).
- Direkte barn av flex-kolonner med fast høyde klemmes 2px flate uten `flex-shrink: 0`
  (`.page-content > *` har det; husk det på nye flex-kolonner).
- **Nye klasser får modulprefiks** (`.rv-`, `.pf-`, `.mk-`, `.ah-`, `.qr-`, `.ark-`) —
  `.kpi-kort` fikk to topplinjer da to sider definerte den hver.
- Fila har ingen cascade-lag: en regel med smalere maks-bredde må stå **senere** enn
  `--content-max`-regelen for å vinne.
- `--topbar-h` deles av toppbaren og logoblokken i sidemenyen — ellers møtes ikke
  skillelinjene.

### Next-spesifikke feller

- **`useSearchParams()` tvinger hele treet under seg til klientrendring** — siden svarer
  200 med tomt innhold til JS-en har lastet (`BAILOUT_TO_CLIENT_SIDE_RENDERING`), og
  verken bygg, typecheck eller lint sier fra. Skjedde på både innlogging og `/nytt-passord`.
  Les query fra `window.location` ved innsending i stedet.
- `localStorage` i en `useState`-initialverdi gir hydreringsfeil — les i `useEffect` etter
  montering (mønsteret i `Layout` og `Temaknapp`).
- Redirects bak proxy: bygg adressen fra `Host` + `x-forwarded-proto`, aldri
  `new URL(sti, req.url)` — `req.url` er den interne adressen, og brukeren kastes ut av
  domenet sitt.
- Ny rute på markedsverten må inn i `erMarked()` i `src/middleware.ts`; nye statiske
  flater i `alltidTillatt`. Vertsdelingen er dybdeforsvar — hver plattformrute må uansett
  kreve plattformadmin på serveren. Lenker på tvers av verter må være absolutte
  (`APP_URL`/`panelLenke()`).
- Rutegruppene: `(app)` = kundeappen (klientsider bak `OktProvider`), `(marked)` =
  landingssiden (serverkomponenter, SEO), `(plattform)` = panelet (serverlayout gater med
  `notFound()`, lilla `.pf-`-palett fordi origin deles). Offentlige QR-sider ligger utenfor
  gruppene (`/kvittering/[token]`, `/rutine/[token]`).

### Utskrift — to mekanismer

- **A4-ark som egen rute** (`/oppgaver/[id]/ark`, `.ark-*`-klassene, utenfor `Layout`) —
  `print-color-adjust: exact` må stå, ellers fjerner nettleseren fargebåndet. QR-koden
  kommer som data-URI fra API-et så arket aldri printes tomt.
- **Vanlige appsider printes rent** via print-blokken **sist** i `globals.css` (mønster:
  vernerunderapporten). Skjul-lista der er en *eksplisitt* liste med klassenavn — en ny
  skjermknapp med eget klassenavn havner på papiret til den legges til. Bruk `.card`
  (`break-inside: avoid`) for det som ikke skal deles over sideskift.

## Fallgruver

- **`sum()` på integer gir bigint, og node-postgres returnerer bigint som STRENG.**
  «806205013 tokens» var 80 620 og 5 013 limt sammen med `+`. Typene lyver — gjennom
  `Number()` før aritmetikk.
- **Regnskapskoblingen** krever `FIKEN_TOKEN_KEY` (64 hex, krypterer kundenes tokens) og
  for OAuth `FIKEN_CLIENT_ID`/`FIKEN_CLIENT_SECRET` — alle koblet i compose. Testmiljøet
  har egen tokennøkkel; prod må få sin egen. API-nøkkel-modus finnes kun i test
  (`ER_TESTMILJO`). Se `docs/fiken.md` «Steg 2 slik det ble».
- **En ny env-variabel må kobles gjennom `docker-compose.yaml`.** AI-rådgiveren feilet
  med 503 fordi `ANTHROPIC_API_KEY` sto i `.env` men ikke i compose — variabelen fantes
  ikke i containermiljøet uansett.
- **Økonomimodulen lagrer beløp i ØRE** (`budget_lines.amount`, `supplier_invoices.amount`,
  `unit_fee_rates.monthly_amount`); resten av appen bruker hele kroner (`contracts.annualSum`,
  `parking_leases.pricePerMonth`). Konverteringen bor i `lib/okonomiregler.ts` (`tilOre`/
  `kroner`) — gang aldri med 100 andre steder. Se `docs/fiken.md` «Steg 1 slik det ble».
- `timestamp` uten sone leses av node-postgres som lokaltid — auth-tabellene er lagt om
  til `timestamptz`; bruk det på nye tidskolonner.
- **Liste og detalj skal ha like joins.** `hentOppgaver` joinet leverandør, `hentOppgave`
  ikke — samme oppgave viste navn i lista og «—» på detaljen, og ingen test så det (begge
  svar var gyldige, bare ulike).
- TOTP: hemmeligheten i `totpURI` er base32-kodet, `createOTP` tar den rå — glemmes
  dekodingen, er hver kode «Invalid code» uten annet spor.
- MCP-serverne i `.mcp.json` kjøres i Docker (ingen Node på verten) med absolutt repo-sti;
  `better-auth`-serveren er pinnet eldre enn appens versjon — generert oppsett sjekkes mot
  `src/lib/auth.ts`. Se `docs/mcp-servere.md`.
- `.env` committes aldri; `mockups/` er gitignorert arbeidsmateriale — layoutintensjon,
  ikke fasit for farger eller merkevare (fasiten er tokenene i `globals.css`).

## Versjon og endringslogg

Versjonen er hardkodet som `versjon`-prop på `OktProvider` **to steder** —
`(app)/layout.tsx` og `(plattform)/layout.tsx` — og vises i sidemenyfoten og på innsendte
feilmeldinger. `package.json` sier 0.0.0 og leses ikke av noe. Bumpes versjonen, må begge
layoutene med, og `CHANGELOG.md` få en oppføring i samme commit.

**1.0.0 (16.08.2026)** er første utgivelse: v2 overtok testmiljøet (`test.driftiq.no`,
`test-admin.driftiq.no`) fra v1 0.8.3. v2 starter altså ikke på v1s nummerrekke.
**25.08.2026 overtok v2 produksjonen** (`app.driftiq.no`); det ga ingen ny versjon, bare en
datert oppføring i loggen, og `versjon`-propen står fortsatt på 1.0.0 selv om `main` har
gått videre. `CHANGELOG.md` er den interne loggen; bare **utgitt** arbeid får et nummer,
patch er standard.

Den **kundevendte** loggen finnes ennå ikke — verken fil eller changelog-rute. Den skulle
kommet med prod-overtakelsen og er dermed forfalt; når den lages gjelder v1-regelen: to
logger med samme versjonsnummer.

## Ved endringer

**Alt arbeid skjer direkte på `main`. Ingen feature-brancher** — én utvikler, og en
glemt branch lot prod bygge gammel kode i ukevis i v1. Det gir to plikter:

- **`git push` er ikke deploy — men det er siste stopp før det.** VPS-en henter selv med
  `git pull`; alt i `origin/main` blir med neste deploy. Uferdig arbeid kan ligge som
  lokale commits; push når du er komfortabel med at det havner ute.
- **Hold `main` byggbar.** Ikke push en tilstand der `docker compose up --build` ryker.

**Spør når du er usikker** på om noe skal pushes, deployes eller versjonsnummereres —
det er billigere enn å rulle tilbake noe som ligger i prod.
