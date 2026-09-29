# Tekniske beslutninger

Datert logg over valg der et åpenbart alternativ ble forkastet — ny avhengighet eller
tjeneste, endringer i RLS, auth, e-post eller bakgrunnsjobber. Nyeste øverst. Hver oppføring:
**hva** som ble valgt, **hvorfor**, og **alternativene** som ble vurdert.

Beslutninger fra før denne fila (28.09.2026) står der de ble tatt: `README.md` (arkitektur),
`CLAUDE.md` og notatene i `docs/`.

---

## 29.09.2026 — BIR-tømmedager hentes ved skraping av bir.no, lagret og hentet om natta

**Hva:** Tømmedagene til oppslagstavla hentes fra BIRs nettside (JSON-søk + HTML-kalender,
`docs/bir.md`) av en nattlig jobb og lagres i `bir_pickups`. Skjermen leser bare tabellen.

**Hvorfor:** Salget starter mot boligselskap i Bergen, og BIR har ikke noe dokumentert API.
Nettsiden er eneste åpne kilde. Lagring gir en tavle som står når bir.no er nede eller har
endret seg, og holder belastningen på BIR til ett kall per borettslag per døgn.

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
