# Tekniske beslutninger

Datert logg over valg der et åpenbart alternativ ble forkastet — ny avhengighet eller
tjeneste, endringer i RLS, auth, e-post eller bakgrunnsjobber. Nyeste øverst. Hver oppføring:
**hva** som ble valgt, **hvorfor**, og **alternativene** som ble vurdert.

Beslutninger fra før denne fila (28.09.2026) står der de ble tatt: `README.md` (arkitektur),
`CLAUDE.md` og notatene i `docs/`.

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
