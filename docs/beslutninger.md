# Tekniske beslutninger

Datert logg over valg der et åpenbart alternativ ble forkastet — ny avhengighet eller
tjeneste, endringer i RLS, auth, e-post eller bakgrunnsjobber. Nyeste øverst. Hver oppføring:
**hva** som ble valgt, **hvorfor**, og **alternativene** som ble vurdert.

Beslutninger fra før denne fila (28.09.2026) står der de ble tatt: `README.md` (arkitektur),
`CLAUDE.md` og notatene i `docs/`.

---

## 01.10.2026 — Avtalehistorikk i egen tabell, ikke månedlig snapshot (BL-182)

**Hva:** «Avtalt årlig inntekt per måned» i Statistikk regnes fra
`platform_contract_versions`: én rad per periode med avtalt årssum, `valid_from` og
eksklusiv `valid_to`. Raden skrives av `settAbonnement`/`slettAbonnement` i samme
transaksjon (`lib/avtalehistorikk.ts`). Avtaler fra før tabellen fantes, ble ført inn én
gang ved oppstart fra startdatoen. Samtidig: statusbytter på leads i
`lead_status_changes`, og kilde/avslagsgrunn som Postgres-enum (samme mønster som
selskapsform).

**Hvorfor:** `platform_contracts` overskrives ved hver lagring, så historikken fantes ikke.
Å føre den der den endres, er det eneste som fanger en endring midt i måneden. Det krever
heller ingen ny jobb.

**Alternativer:**
- *Månedlig snapshot fra en node-cron-jobb.* Forkastet: jobbene har ikke vern mot
  dobbeltkjøring (se CLAUDE.md «Bakgrunnsjobber»), en jobb som ikke kjørte en måned gir et
  hull, og en rabatt som ble lagt inn og fjernet innenfor samme måned ville aldri blitt sett.
- *Regne historikk fra dagens kontrakt (`start_date`).* Forkastet som varig løsning: den
  antar at prisen aldri har endret seg. Brukt én gang, for utfyllingen av avtalene som
  fantes (avklart med eier).
- *Statusbytter lest ut av `lead_activities.text`.* Forkastet utenom engangsutfyllingen:
  teksten er norsk prosa for mennesker, og en omformulering ville stille brutt trakten.
- *Registreringer talt fra `audit_events`.* Forkastet: avvik, oppgaver og driftslogg logger
  ikke dit. Statistikk teller rader per org og tidspunkt i modultabellene, aldri innhold.

## 01.10.2026 — Fylke på boligbyggelag som enum-liste, «Siden sist» fra innloggingsloggen

**Hva:** `bbl.county_codes` er `fylkeenum[]` med SSB-fylkesnummer (`03`, `46`, …), lista og
navnene i den importfrie `lib/fylker.ts`. Det er en LISTE fordi et boligbyggelag ofte dekker
flere fylker. Migrasjon 0069 tolket kjente skrivemåter av fritekstfeltet `region`
(fylkesnavnene, og «Vestlandet» som Vestland etter avklaring med eier) og tømte `region` der
den ble tolket. Resten blir stående, vises som «Ukjent» i panelet og listes av
`scripts/fylke-rapport.ts`; `region` droppes i egen migrasjon når rapporten er tom.

Samme dag: «Siden sist du var her» på I dag regnes fra nest siste `innlogget`-rad i
`auth_events`, ikke fra en ny kolonne på `users`.

**Hvorfor:** Fritekst ga både «Vestland» og «Vestlandet». Enum følger presedensen fra
selskapsformen over: lista håndheves av databasen, ikke bare av appen. Nummer og ikke navn,
så et fylke som skifter navn igjen er én linje i `fylker.ts`. For «Siden sist» finnes
tidspunktet allerede: krokene i `auth.ts` skriver hver innlogging til `auth_events`.

**Alternativer:**
- *Ett fylke per lag.* Forkastet: Vestbo og OBOS har kunder i flere fylker, og et valg ville
  vært tilfeldig.
- *Koblingstabell `bbl_counties`.* Forkastet: lista leses alltid sammen med laget og
  filtreres aldri på; en tabell måtte inn i RLS-registeret for ingenting.
- *`users.previous_login_at` satt i innloggingskroken.* Forkastet foreløpig: krever
  migrasjon og en ekstra skriving i innloggingen for noe loggen allerede har. Prisen er
  oppbevaringen på 90 dager; er forrige innlogging eldre, viser siden «siste 90 dager».
  Blir det et problem, er kolonnen løsningen.

## 01.10.2026 — Selskapsform som Postgres-enum med Brreg-koder

**Hva:** `organizations.org_form_code` er enumen `orgformenum` (`BRL`, `ESEK`, `SAM`, `AS`).
Lista og visningsnavnene bor i den importfrie `lib/selskapsform.ts`, som både skjemaet og
nedtrekkslistene leser. Migrasjon 0068 fylte koden fra fritekstfeltet `org_form` for kjente
varianter; resten ble NULL og listes av `scripts/selskapsform-rapport.ts`. `org_form`
står igjen urørt til rapporten er tom, og fjernes da i egen migrasjon (drizzle-kit takler
ikke å legge til og fjerne i samme generering). Org.nr-oppslaget setter koden fra Brreg når
den er på lista; en ukjent kode lagres ikke, men vises i «Krever handling».

**Hvorfor:** Fritekst ga «Borettslag », «borettslag» og «BRL» som tre grupper i
statistikken, og «DEMO» ble brukt som selskapsform. Koden er det registeret selv bruker,
så oppslaget kan sette den uten tolkning.

**Alternativer:**
- *Oppslagstabell (`org_forms`).* Forkastet: lista endres sjelden og redigeres aldri i UI.
  En tabell måtte inn i RLS-registeret og hatt en join i hver spørring, og repoet bruker
  allerede enum for faste lister (`roleenum`, `accesslevelenum`, `frequencyenum`).
- *`varchar` med Zod-enum (som `affiliation_type`).* Forkastet: da håndheves lista bare
  av appen, og et SQL-skript eller en migrering kan skrive fritekst igjen.
- *Lagre visningsnavnet.* Forkastet: navnet er vårt (AS vises som «Boligaksjeselskap»), og
  et omdøpt navn ville krevd datamigrering.

---

## 01.10.2026 — «Krever handling»: påminnelse på e-post i stedet for invitasjon fra panelet

**Hva:** Kundedetaljen viser punktene som krever handling (`lib/kundehandlinger.ts`). For
onboarding-punkter kunden selv må løse, sender knappen en ny e-posttype,
`sendOppstartspaminnelse`, til kundens aktive orgadmins. Plattformadmin og kontoansvarlig
er unntatt. Sendingen ligger i `etterCommit`, og hver påminnelse logges i kundens
hendelseslogg. Også «Inviter styremedlem» er en slik påminnelse (be orgadmin invitere
styret).

**Hvorfor:** Panelet skal ikke gi innsyn i kundedata, og å invitere brukere hos en kunde er
kundens orgadmin sin jobb. En e-post som sier *hva* som mangler, gir ingen ny vei inn i
tilgangskontrollen.

**Alternativer:**
- *Invitere brukere direkte fra panelet.* Forkastet: det ville vært en ny skrivevei inn i
  kundens brukerliste utenom support-modus og `krevOrgAdmin`.
- *Bare en lenke/tekst uten utsending.* Forkastet: plattformadmin ville måtte skrive
  e-posten selv, og påminnelsen hadde ikke blitt logget.

---

## 01.10.2026 — «Slett kunde» er hard sletting, bak inaktiv-status og navnebekreftelse

**Hva:** Plattformpanelet kan slette en kunde for godt (`lib/kundesletting.ts`): raden,
alle tabellene den eier, filene under `uploads/orgs/{orgId}/` (etter commit) og
brukerkontoer som ikke er med i andre kunder og ikke er plattformadmin. Knappen er død til
kunden er satt inaktiv, og navnet må tastes inn (sjekket på serveren). Sletting nektes
så lenge kunden har Unloc-nøkler som ikke er trukket tilbake. Tabellene uten
`ON DELETE CASCADE` mot `organizations` slettes i FK-riktig rekkefølge og står i
`SLETTES_EKSPLISITT`, som en test sammenligner med fremmednøklene i databasen.
`plattformRute` fikk `etterCommit` for filslettingen.

**Hvorfor:** Testkunder som ikke går videre skal kunne fjernes helt, og en kunde som sier
opp har krav på sletting. To steg (inaktiv → slett) gjør at kunden allerede har vært stengt
ute før noe forsvinner.

**Alternativer:**
- *Myk sletting (`deleted_at`).* Forkastet: dataene ville ligget igjen, og hver spørring på
  tvers måtte filtrert dem bort. Inaktiv-statusen er allerede den myke varianten.
- *Gjøre alle fremmednøkler til `CASCADE` med en migrasjon.* Forkastet foreløpig: de 12
  uten kaskade er arv fra v1-skjemaet, og å endre dem endrer også hva en vanlig sletting av
  f.eks. en leverandør gjør inne i kundeappen.
- *Beholde kundens brukerkontoer.* Forkastet: en konto uten medlemskap slipper inn i en tom
  app, og personopplysningene skal ut med kunden.
- *Sette leaden kunden kom fra til «avslått».* Forkastet: skjemaet bestemmer at den beholder
  «konvertert» (`leads.convertedOrgId`). Den får i stedet en linje «Kunden slettet» i loggen.

## 30.09.2026 — Oppslagstavla: bilder konverteres med vips, og bildeoppslag begynner som kladd

**Hva:** (1) Opplastede bilder og PDF-sider gjøres om til WebP med `vips` fra Alpine-pakkene
(`vips-tools`, `vips-heif`, `libheif-libde265`), kjørt som prosess fra `lib/tavlebilder.ts`.
(2) Et nytt bildeoppslag opprettes som kladd idet første fil lastes opp, og legges ut
etterpå. (3) `proxyClientMaxBodySize` er satt til 25 MB i `next.config.ts`.

**Hvorfor:** HEIC fra iPhone må kunne lastes opp, og skjermene (TV-nettlesere) skal bare
trenge å vise vanlige bilder. Kladden gjør at hver fil lastes opp for seg, med fremdrift og
feil per fil, før styret trykker «Legg ut». Med middleware kutter Next forespørselskroppen
ved 10 MB som standard; filene her kan være 20 MB.

**Alternativer:**
- *`sharp`* (ligger allerede i `node_modules` via Next). Forkastet: de ferdigbygde binærene
  leser ikke HEIC (HEVC er ikke med), og å bygge sharp mot systemets libvips er mer
  skjørt enn å kalle `vips` direkte. Verktøy som prosess er også mønsteret fra før
  (`pdftoppm`, `tesseract`).
- *Holde filene i nettleseren til «Legg ut».* Forkastet: fremdrift og feil per fil kommer da
  først etter at man har trykket, og en PDF kan ikke vises som sider før den er konvertert.
- *Beholde originalfilene.* Forkastet: de spiser kvote uten å bli vist, og HEIC kan uansett
  ikke vises av skjermene.

## 30.09.2026 — Oppslagstavla: felt velges per skjerm, migrert i TypeScript

**Hva:** (1) Hva som står i hvert felt, lagres per skjerm (`board_screens.zones`) og velges i
et klikkbart kart over malen. Plassering per blokk (`board_placements`) er utgått. Et felt
kan ha flere blokker, som roterer. (2) Migreringen av eksisterende skjermer er et idempotent
TypeScript-steg i `scripts/oppstart.ts` (`lib/tavlemigrering.ts`), ikke en SQL-migrasjon.

**Hvorfor:** Dette snur justeringen fra 29.09 (under). Plassering på innholdet spredte
oppsettet over seks kort i Innhold-fanen, og styret kunne ikke se hva en skjerm viste uten å
lese alle. Innvendingen mot sone for sone den gangen var at det var omstendelig; kartet, der
feltet klikkes og forhåndsvisningen følger med, er svaret på den. TypeScript for migreringen
fordi den gamle regelen (`fordelSoner`) da brukes som den er, og skjermene viser det samme
etterpå per konstruksjon.

**Alternativer:**
- *Strengt én innholdstype per felt.* Forkastet: den gamle modellen roterte flere blokker i
  ett felt, så migreringen ville endret det skjermene viser.
- *Migrering i SQL.* Forkastet: en SQL-kopi av `fordelSoner` er en ny tolkning av regelen,
  med malene gjentatt i en `CASE`.
- *Droppe `board_placements` i samme omgang.* Utsatt: SQL-migrasjonene kjører før
  TypeScript-steget, så tabellen må finnes til alle miljøer har kjørt det.

## 29.09.2026 — Oppslagstavla: maler med soner, eksterne data i minnet, kontakter fra brukerne

**Hva:** (1) Hver skjerm velger en mal med faste soner, og styret plasserer blokker i
sonene — i stedet for én layout der felt slås av og på. (2) Avganger (Entur) og vær (MET) er
blokker med egne innstillinger i `board_blocks`, og svarene holdes i minnet på serveren
(`docs/entur-yr.md`). (3) Kontaktpersonene er DriftIQ-brukere med vis/skjul per felt, ikke
manuelle oppføringer.

*Justert samme dag:* sone for sone per skjerm (A/B/C/D) var for omstendelig. Plassering
velges nå på innholdet (hovedfelt/sidefelt/stripe + skjermer, `board_placements`), og
sonene regnes ut av malen. `board_screens.zones` er fjernet (0065).

**Hvorfor:** Styret ville bestemme hva som står hvor, uten at tavla kan bli uleselig. Vær og
avganger er per sted/holdeplass, og en org trenger flere. Kontaktinfo skrevet inn for hånd
går ut på dato; profilen er fasiten, og den som går ut av styret skal forsvinne av seg selv.

**Alternativer:**
- *Fritt rutenett med dra og slipp.* Forkastet: mye mer å bygge, og lett å lage noe
  uleselig på en vegg. Malene dekker behovet med fem–seks valg per retning.
- *Alt i én rotasjon i det store feltet.* Forkastet: avganger og vær må kunne leses i
  forbifarten, ikke hvert tredje minutt.
- *Lagre avganger og vær i basen (som BIR).* Forkastet: avganger er sanntid og foreldes på
  sekunder, og MET krever at vi følger deres `Expires` — et minnelager per prosess er
  enklest og riktigst så lenge appen kjører som én instans.
- *METs egne værikoner.* Forkastet: ~80 SVG-er å hente og vedlikeholde; lucide har det som
  trengs, og fila med symbolkoder er importfri og testet.
- *Manuelle kontakter ved siden av brukerne.* Forkastet på eiers ønske: to kilder til samme
  opplysning er det som driver fra hverandre.

## 29.09.2026 — BIR-tømmedager hentes ved skraping av bir.no, lagret og hentet om natta

**Hva:** Tømmedagene til oppslagstavla hentes fra BIRs nettside (JSON-søk + HTML-kalender,
`docs/bir.md`) av en nattlig jobb og lagres i `bir_pickups`. Skjermen leser bare tabellen.

**Hvorfor:** Salget starter mot boligselskap i Bergen, og BIR har ikke noe dokumentert API.
Nettsiden er eneste åpne kilde. Lagring gir en tavle som står når bir.no er nede eller har
endret seg, og holder belastningen på BIR til ett kall per borettslag per uke (først hver
natt; ukentlig holder fordi kalenderen dekker tre måneder — flyttes en dag, er «Hent nå» der).

**Alternativer:**
- *Hente live fra skjermen eller per forespørsel.* Forkastet: hver skjerm hvert minutt mot en
  nettside vi ikke har avtale om, og tavla ville blitt tom ved første endring hos BIR.
- *Manuell liste som styret fører.* Forkastet som hovedløsning: BIR flytter tømmedager ofte
  («Derfor flyttes tømmedagen oftere»), og en utdatert dato på veggen er verre enn ingen.
- *Vente på et avtalt API fra BIR.* Utsatt, ikke forkastet: bygget som fjernbar pakke så
  kilden kan byttes når BIR svarer.

## 29.09.2026 — Oppslagstavla: skjermen er en nettleser med enhetstoken, nytt RLS-unntak «skjerm»

**Hva:** Infoskjermene (`docs/oppslagstavle.md`) er en nettside (`/skjerm`) i fullskjerm.
De kobles med en engangskode som styret skriver inn, og får et enhetstoken (bare sha256
lagres). Skjermrutene slår opp tokenet med `withoutRls("skjerm")` — en ny verdi i
`RlsUnntak` — og kjører alt annet i `withOrg`.

**Hvorfor:** Skjermen har ingen bruker, og org-en er ukjent til tokenet er slått opp —
samme situasjon som QR-flyten. Et eget navn framfor å gjenbruke `"qr-anonym"` gjør hvert
unntak søkbart etter formål. Unntaket dekker ett oppslag på én unik kolonne; innholdet
leses under RLS som i appen.

**Alternativer:**
- *Egen app på skjermen (Tizen/Android) fra start.* Utsatt: nettleseren dekker Samsung URL
  Launcher, Android-bokser og Raspberry Pi uten en ny leveranse å vedlikeholde og publisere.
  Kan legges oppå samme API senere.
- *Skjermen som en Better Auth-bruker.* Forkastet: en «bruker» per skjerm ville dukket opp i
  brukerlister og medlemskap, og krevd passord eller sesjonsfornying på en TV.
- *Token i URL-en (`/skjerm/{token}`).* Forkastet: havner i tilgangslogger og nettleserhistorikk,
  og en som tar bilde av adresselinja har tilgangen. Tokenet går i `Authorization`-headeren.
- *Gjenbruke `"qr-anonym"`.* Forkastet, se over.

## 28.09.2026 — Egen krypteringsnøkkel for integrasjoner: `INTEGRASJON_NOKKEL`

**Hva:** Tokens og nøkler til Fiken, Easee og Unloc krypteres (AES-256-GCM,
`lib/kryptering.ts`) med én felles nøkkel fra `.env`, `INTEGRASJON_NOKKEL`. Den het
`FIKEN_TOKEN_KEY` fordi Fiken kom først; navnet fikk den til å se ut som kundens Fiken-token,
som legges inn i orginnstillingene. Omdøpt før prod fikk nøkkelen, så ingen overgang trengtes.

**Hvorfor:** Nøkkelen skal ligge utenfor databasen, slik at en dump eller backup alene ikke
gir tilgang til kundenes regnskap.

**Alternativer:**
- *Avlede fra `BETTER_AUTH_SECRET` (HKDF).* Forkastet: den byttes når innlogging kan være
  kompromittert, og da ville alle integrasjonskoblinger dødd samtidig. En lekkasje ville også
  gitt både sesjoner og regnskapstokens. `jwks`-raden er allerede kryptert med den (og veltet
  testmiljøet ved dump-seeding).
- *Lagre nøkkelen i innstillinger/databasen.* Forkastet: nøkkel og chiffer på samme sted.
- *Én nøkkel per integrasjon.* Forkastet: samme trusselbilde, mer å forvalte. Formatet
  `v1:…` tillater rotasjon senere.
