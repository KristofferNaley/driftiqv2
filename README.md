# DriftIQ v2

Omskrivingen til Next.js + Better Auth. **I produksjon siden 25.08.2026** (`app.driftiq.no`,
`admin.driftiq.no`, `driftiq.no`); v1 er tatt ned. Delte aldri noe med v1 utover den
sentrale Postgres-serveren.

**Status: fase 1 og 2 ferdig.** Kundeappen er komplett — dashbord med flyttbare widgets,
alle modulsidene, detaljvisninger, anonym QR-flyt, utskriftsark og varselsjobber.
Plattformpanelet er også komplett: kunder, prismodell, boligbyggelag, statistikk,
systemhelse, HMS-maler og support-sesjoner. 414 tester grønne over 30 filer.

Siden det: profilmodalen har vertikale faner med selvbetjent tofaktor (TOTP med
backup-koder) og «Min aktivitet» per person, driftsloggen flettes fra fem kilder ved
lesing, oppgavedetaljen er redigerbar med sjekklisten som radeditor, dokumentmetadata kan
endres, og AI-rådgiveren åpner med statuskort regnet fra lagets egne tall.

Gjenstår (fase 3): leverandørportalen (null brukere i dag) og modulkatalogen på `/moduler`.

| Miljø | App | Database |
|---|---|---|
| **Prod (v2)** | **3008** — localhost, via Cloudflare-tunnelen | **`driftiq_v2`** |

v1 (prod 3002/3003/8000, test 3005/3006/8001, databasene `driftiq` og `driftiq_test`) er
tatt ned. Testmiljøet for v2 er `/root/driftiqv2-test` (port 3009, `driftiq_v2_test`; se
«Tester» i CLAUDE.md).

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

Prosjektnavnet blir `driftiqv2` av mappenavnet; ingen `-p` er nødvendig. Settes det opp et
testmiljø fra samme repo på samme vert, må det kjøres med eget `-p` — v1-lærdommen var at
test og prod ellers kolliderer på prosjektnavn.

## Kjørende miljø

Stacken er produksjon og kjører på port 3008 mot de migrerte kundedataene: innlogging,
sesjon, `/api/meg`, alle modulendepunktene, skriving, validering, modulgate og tenantisolasjon.
En bruker uten medlemskap i org-en får 403, og en avslått modul får 403 — begge med API-ets
egen norske melding.

Testbruker i databasen: `claude@driftiq.test`, medlem (orgadmin) i to organisasjoner, så
org-velgeren faktisk har noe å vise. Passordet er satt lokalt og finnes ikke i repoet. Merk
at brukeren og organisasjonene den er medlem i ligger i produksjonsbasen.

**Plattformpanelet kan ikke UI-testes av en agent.** Begge plattformadmin-kontoene er ekte
brukere, og en agent skriver ikke passord inn i innloggingsfelt — og skal heller ikke heve
rollen til en testbruker for å komme rundt det. Panelet dekkes derfor av tester
(`tests/plattform.test.ts`, `tests/kundedetalj.test.ts`), og UI-et må klikkes gjennom manuelt.

**En plattformadmin med medlemskap i en org får ingen tilgang av medlemskapet.** Alle
gatene i `lib/tilgang.ts` sjekker rollen først og krever support-sesjon uansett. Org-en
dukker likevel opp i org-velgeren, og alle kall svarer 403 til sesjonen er startet — se
`docs/`-notatene hvis dette skal forbedres.

## Kommandoer

**Containeren har ingen kildemount.** Kildekoden i den er et snapshot fra forrige
image-bygg, så `docker compose exec app npm run typecheck` sjekker KODEN SOM VAR — den
svarer grønt på endringer den aldri har sett, og feilen er stille i begge retninger
(påvist 09.08.2026: typecheck, lint og hele testsuiten «grønne» mot en dag gammel kopi).
Sjekk filene på verten i en engangscontainer i stedet:

```bash
# Typesjekk + lint av det som faktisk ligger på disk. Next-bygget alene beviser ikke at
# koden kan kjøre — samme lærdom som at `vite build` i v1 bygget grønt med en glemt import.
docker run --rm -v "$PWD:/app" -w /app node:22-alpine sh -c "npx tsc --noEmit && npx eslint ."
```

```bash
# Sikkerhetstestene. Krever ekte Postgres og kjøres derfor i containeren, som v1-suiten —
# men først etter `docker compose up -d --build`, ellers tester de forrige image.
docker compose exec app npm run test
```

## Verktøy

`.mcp.json` setter opp to MCP-servere for Claude Code — Next.js-devtools og Better Auth.
Begge kjøres i Docker fordi det ikke er installert Node på verten. Se
[docs/mcp-servere.md](docs/mcp-servere.md) for hva de faktisk gir, og hva de ikke gir.

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

**Historikk bærer navnet OG bruker-id-en — og de svarer på ulike spørsmål.** Utkvitteringer,
avvik, behandlinger, driftslogg og enhetsarbeid lagrer navnet kopiert inn (protokollen: raden
skal lese likt om ti år, også etter navnebytte eller slettet konto) og en nullbar `*_user_id`
ved siden av (søkenøkkelen: «hva har JEG gjort» og «vis nåværende navn» går på den). Skrives
gjennom `Aktor`-typen i `lib/aktor.ts`; QR-flyten er anonym og har bare navnet, som før.
Sjekklistepunkter følger samme tanke: uendret tekst beholder id-en, så statistikk per punkt
(«hvor mange rens har Vask 3 hatt?») overlever redigering — et omdøpt punkt er et NYTT punkt.

**Driftsloggen flettes ved lesing, aldri ved skriving.** Bare manuelle notater har egne rader;
oppgaver, avvik, vedlikehold og vernerunder leses fra sine egne tabeller i
`hentDriftsloggSamlet`. En loggkopi per hendelse ville gitt to sannheter som driver fra
hverandre.

**Versjonerte migrasjoner.** v1 hadde hånd-rullet idempotent SQL i `_apply_migrations()`. Det
virket, men ga ingen historikk og ingen vei tilbake. Her genererer drizzle-kit SQL som sjekkes
inn. RLS-policyene settes fortsatt programmatisk, fordi de skal kunne endres for alle tabeller
samtidig.

## Hva som IKKE er portert

**Leverandørportalen.** v1 lar en leverandør logge inn og kvittere ut sine egne oppgaver.
Null brukere i dag, derfor sist.

**Modulkatalogen på `/moduler`.** Salgssiden for moduler kunden ikke har. Modulgaten selv
virker — direktenavigering til en avslått modul gir `ModuleLocked`.

**Vernerunde-PDF-en** (`report.py`, ReportLab). Bekreftet ubrukt 09.08.2026 og dermed ute
av portens omfang, ikke bare utsatt. (Unloc sto her også, men ble bygget på nytt 05.09.2026
fra Unloc API v2 — som én fjernbar pakke, se `docs/unloc.md`.)

**Tidslinjevisningen på årshjulet.** v1 har en andre visning med canvas-målte brikker og
kollisjonsbaner. Månedsrutenettet svarer på det samme, og tidslinja er den dyreste delen av
v1s 624 linjer.

**Bulk-import av enheter og adressesøk mot Kartverket.**

### Sikkerhetslaget sto først

`src/db/rls/tables.ts` bar **hele** tabellista fra v1 fra dag én, mens skjemaet ennå bare
hadde en håndfull tabeller. `settOpp()` hoppet over det som ikke fantes. Rekkefølgen var
bevisst: sikkerhetsspesifikasjonen skulle være komplett før modulene kom, ikke vokse etter
dem. Skjemaet har nå 56 tabeller, og `test_ingen_tenanttabell_uten_dekning` feiler hvis en ny
en mangler dekning.

## Neste steg

1. Fase 3 — leverandørportalen og modulkatalogen.
2. Påkrevd tofaktor for plattformadmin. Oppsettsflyten er bygget og profilen varsler om at
   kravet kommer, men håndhevingen (i `sjekkInnloggingssperrer`, lib/tilgang.ts) er ikke
   skrudd på.
3. Passkeys — en plugin til, nå som Better Auth står.
4. ~~Et testmiljø adskilt fra prod.~~ **Gjort 03.09.2026**: `/root/driftiqv2-test` på samme
   vert, `test.driftiq.no` rutet dit. Se CLAUDE.md «Kommandoer og verifisering».
5. Sikkerhetskopien ut av VPS-en. `/root/backup/backup-driftiqv2.sh` tar nattlig `pg_dump`
   og tar av opplastingene, men kopiene ligger lokalt. Restore ble testet 03.09.2026 ved
   seeding av testmiljøet: dump og opplastinger inn, migrasjoner og RLS-oppsett gikk rent.

## Webanalyse

Umami, servert **førsteparts** under `/stats/` — proxyen ligger i
`src/app/stats/[...sti]/route.ts`, siden v2 ikke har noen nginx slik v1 hadde. Umami selv er
en egen stack (`~/umami/` på VPS-en) på det delte `edge`-nettet, ikke en del av denne.

Landingssiden og kunde-appen har hver sin nettsteds-ID (`UMAMI_NETTSTED_MARKED` /
`UMAMI_NETTSTED_APP`); plattformpanelet har bevisst ingen. Er en ID tom, legges ingen
skripttagg inn — derfor er analysen av i test og lokalt, og skal være det: testklikk hører
ikke hjemme i prod-tallene.

## Portert så langt

| Modul | Merknad |
|---|---|
| Parkering | komplett |
| Årshjul | komplett — månedsrutenett; tidslinjevisningen er ikke portert |
| Driftslogg | komplett — samlet tidslinje flettet fra fem kilder, med kildefilter og periode |
| Leiligheter og fellesområder | mangler bulk-import og adressesøk mot Kartverket |
| Oppgaver | komplett — inkl. QR, anonymt skjema, bilder, utskriftsark og «Info til leverandør» (generert e-post, sendbar fra appen) |
| Avvik | komplett — inkl. vedlegg |
| Kontrakter | komplett — første modul med filopplasting |
| Dokumentarkiv | komplett — mapper, undermapper, speilmapper og søk |
| Leverandører | mangler portalbruker (fase 3). Digitale nøkler via Unloc: bygget, ikke prøvd mot ekte Unloc — `docs/unloc.md` |
| Vedlikehold | komplett |
| Rutiner | komplett |
| HMS-maler | komplett (plattformdata — `plattformRute`, ikke `orgRute`) |
| Internkontroll | komplett — PDF-rapporten er ute av omfang, se over |
| AI-rådgiver | komplett — startbilde med statuskort fra lagets egne tall; krever `ANTHROPIC_API_KEY` |
| Plattformpanel | komplett — kunder, prismodell, boligbyggelag, statistikk, system, maler |

Alt er dekket av migreringsskriptet.

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
docker run --rm -v "$PWD:/app" -w /app node:22-alpine npx eslint .
```

**Kjør denne — et grønt bygg er ikke bevis på at koden kan kjøre.** (Engangscontainer, ikke
`exec` inn i appen: se «Kommandoer» for hvorfor.) `no-undef` og
`rules-of-hooks` står som `error`; det er de to som faktisk ryker i produksjon. `next lint`
finnes ikke i Next 16, så oppsettet ligger i `eslint.config.mjs`.

## Fillagring

`src/lib/lagring.ts` eier opplasting og kvote. Lagrer modulen din filer, skal tabellen inn i
`FILTABELLER` — ellers teller ikke filene mot kvoten, og `lagring.test.ts` blir rød. Kvoten
er 5 GB som standard, overstyrbar per kunde via `organizations.storage_quota`.

Filer havner under `uploads/orgs/{orgId}/<modul>/` med uuid-navn; brukerens filnavn lagres
kun som visningsnavn og treffer aldri filsystemet.

Filsystem- og `path.join`-kallene i `lagring.ts` er merket `/* turbopackIgnore: true */`.
Uten det kunne ikke Turbopack avgjøre stiene statisk (de bygges fra `UPLOAD_DIR`) og tok med
HELE prosjektet i standalone-bundlet — kildekode og public-mappa inkludert. Volumet monteres
ved kjøring og skal aldri traces; fjernes kommentarene, kommer advarselen tilbake i bygget.

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

Overgangen er gjennomført (25.08.2026). Skriptet beholdes som dokumentasjon av hva som ble
kopiert og hvordan. `scripts/migrer-fra-v1.ts` kopierer direkte fra en v1-database og er
idempotent — det ble kjørt om igjen rett før overgangen for å hente det som var kommet til.

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
