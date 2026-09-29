# Modultilgang per bruker — designnotat

*Utkast 20.09.2026. Idéstadiet — ingenting her er bygget. Henger sammen med
`docs/mobilapp.md` (appens funksjonsutvalg er et forvalg av dette) og
`docs/leverandorportal.md` (en grant har «omfang» — samme begrep).*

## Idéen

Kontoadmin skal kunne gi en bruker tilgang til noen moduler og ikke andre: lov til å bruke
Avvik, men ikke se Kontrakter. I UI-et: ja/nei-bokser per modul for «Se» og «Endre».

Det reelle behovet er trolig smalt — skjule økonomi/kontrakter for enkelte (ansatt
vaktmester, varamedlem), og en «felt»-bruker med bare oppgaver, avvik og rutiner. Men den
generiske mekanismen koster lite mer på serveren enn et hardkodet fjerde nivå.

## Utgangspunktet: matrisen finnes allerede

Hver org-rute (ca. 270 handlere) deklarerer `{ nivaa, modul }` i `orgRute`. Det *er*
rettighetsmatrisen: «CanEditDeviations» = `{ modul: "avvik", nivaa: "redigering" }`.
Gaten står ett sted — `krevNivaa` i `src/lib/api.ts` — og bruker i dag medlemskapets
**globale** nivå uten å se på `modul`. Modultilgang kan derfor innføres uten å røre en
eneste rute.

Ruter uten `modul` (org-metadata, brukerliste, egne varselvalg) følger det globale nivået
som i dag.

## Datamodell

**Ikke navngitte boolske flagg** (`canViewDeviations`, `canEditDeviations`, …):

- to boolske gir den ugyldige kombinasjonen «endre uten å se»
- ny modul = migrasjon + to kolonner — mens `ALLE_MODULER` allerede er fasiten
- 26+ flaggnavn som må holdes like mellom server, klient og tester

**I stedet:** ett nivå per modul, lagret som overstyring på medlemskapet
(`user_org_memberships`) — en kolonne `module_access` med JSON:

```json
{ "kontrakter": "ingen", "okonomi": "ingen", "avvik": "redigering" }
```

- Verdier: `ingen` | `lesing` | `redigering`. **Mangler modulen, arves det globale nivået.**
  `NULL` = ikke tilpasset, som `dashboardLayout`.
- Nøklene er `ModulNokkel` og valideres mot `ALLE_MODULER` ved skriving. Leses gjennom én
  funksjon som også slår opp `GAMLE_ALIASER` — en omdøpt modulnøkkel skal ikke stille gi
  noen tilgangen tilbake (eller ta den fra dem).
- Typen og utregningen (`effektivtNivaa(globalt, overstyring, modul)`) bor i en
  **importfri** fil — klienten trenger den samme regelen. Én funksjon, ikke to.
- Ligger på medlemskapet, ikke brukeren: samme person kan ha ulik tilgang i to lag.

UI-et kan fortsatt være ja/nei-bokser — rutenett med moduler nedover, «Se» og «Endre»
bortover. «Endre» uten «Se» lar seg ikke krysse av. Forskjellen er lagringen.

### Regler

- **`orgadmin` kan ikke begrenses.** Ellers kan en kunde låse seg ute av egen konto, og
  «Kontoadmin» slutter å bety noe. Overstyringer gjelder `redigering` og `visning`.
- **Overstyring kan både heve og senke** innenfor driftsmodulene (en `visning`-bruker kan
  få `redigering` på avvik), men aldri gi kontosidene — de krever fortsatt `orgadmin`.
- **De tre nivåene består som forvalg**, pluss «Tilpasset». De fleste styrer (3–7
  personer) vil aldri åpne rutenettet.
- Modulen må fortsatt være aktivert for orgen. Rekkefølgen i `orgRute` beholdes:
  tilgangsgate → modulgate. Brukerens modultilgang er del av tilgangsgaten.
- Plattformadmin i support-sesjon påvirkes ikke.
- Bare `orgadmin` endrer modultilgang (som nivå i dag), og endringen logges med
  `loggHendelse` i samme transaksjon — tilgangsendringer er revisjonspliktige.

## Serversiden

1. `krevNivaa(db, orgId, bruker, nivaa, modul?)` regner effektivt nivå for modulen.
   Gatene i `tilgang.ts` slår allerede opp medlemskapsraden (`medlemskap()`), og
   overstyringen ligger på samme rad — ingen ekstra spørring. I dag returnerer bare
   `krevOrgTilgang` raden; `krevOrgRedigering`/`krevOrgAdmin` må gjøre det samme, eller
   ta `modul` som parameter selv.
2. `/api/meg` returnerer effektivt nivå **per modul** per org — ferskt per forespørsel som
   alt annet der. Ingen caching i klienten.
3. 403-meldingen sier hva som mangler og hvem som kan fikse det: «Du har ikke tilgang til
   Kontrakter i denne organisasjonen — kontoadmin kan endre det.» Den kommer fra
   tilgangsgaten, før modulgaten, så den røper ikke modulstatus til utenforstående.

## Det egentlige arbeidet: flatene som krysser moduler

Å gate rutene er ikke nok. Disse lekker *stille* — svaret er gyldig, bare for rikt:

| Flate | I dag | Må til |
|---|---|---|
| **AI-rådgiveren** (`lib/ai-verktoy.ts`) | Verktøyene har ingen modulmerking | Merk hvert verktøy med modul, filtrer verktøylista per bruker. Krysstest i `tests/ai.test.ts`. **Viktigst** — ellers svarer den «hva koster heisavtalen» til en uten kontraktstilgang |
| **Globalt søk** (`KILDER` i `lib/sok.ts`) | `modul` per kilde; hopper over deaktiverte moduler | Samme sted: hopp også over moduler brukeren ikke har |
| **Dashboardet** | Widgetene utledes av orgens moduler | Utled av brukerens effektive moduler; hvitelista i `lib/dashbordoppsett.ts` likeså |
| **Varsler** (e-post, senere push) | Mottakerutvalget kjenner ikke modultilgang (finnes ikke ennå) — gå gjennom `lib/varsler.ts` før bygging | Filtrer mottakere på modultilgang ved sending. Webhooks er orgens kanal og berøres ikke |
| **Krysshenvisninger** | Oppgave viser leverandørnavn, avvik peker på oppgave | Navn vises, lenken er ikke klikkbar uten tilgang. **Samme regel i liste og detalj** |
| **Eksport** (`eksport/route.ts`) | `nivaa: "admin"` | Uendret — orgadmin har alt |

Følg registermønsteret: hver søkekilde, hvert AI-verktøy og hver dashboard-widget **må** ha
modulmerking, og en test blir rød om en mangler. Stille svikt → registerfil + test.

### Den tredje handlingen

Noen `lesing`-ruter skriver: `deviations POST` («visning kan melde avvik»), HMS-signering,
AI-spørsmål, egne varselvalg. Se/endre-modellen har altså allerede et unntak. Med
modultilgang blir regelen: **`lesing` på avvik = se + melde.** Ønskes «kan melde, men ikke
se andres avvik» (aktuelt for en app-/feltbruker), er det en fjerde verdi eller en egen
bryter på avviksmodulen — et bevisst valg, ikke noe som skal falle ut av dette notatet.

## Klientsiden

Nivået utledes i dag lokalt i hver side — `aktivOrg?.nivaa === "orgadmin" || …` står 20
steder i 15 filer, og sendes videre som `kanRedigere`-props (brukt i 16 filer).

- `useOkt()` får `kan(modul, "lesing" | "redigering")`, bygget på den importfrie
  utregningen og svaret fra `/api/meg`.
- **Gi feltet `nivaa` på org-objektet nytt navn** (`grunnnivaa`) i samme endring — da
  finner kompilatoren alle 20 sammenligningene. En glemt side ville ellers vist
  redigeringsknapper som svarer 403.
- `menyFor` snittes med brukerens moduler; en side man ikke har tilgang til, skal ikke
  være et menypunkt som ender i en feilmelding.
- Brukerlista viser «Tilpasset»-merke. Kontoadmin skal se hvem som avviker fra forvalgene
  uten å åpne hver bruker.

## Fallgruver

- **Supportbyrden.** «Hvorfor ser jeg ikke X» er v1s lesevisning-uten-forklaring i ny
  drakt. Alt som er skjult må kunne forklares — av 403-meldingen, og av brukerlista.
- **Motstå finere granularitet enn modul.** `internkontroll` (47 ruter) og `okonomi` (54)
  er grove enheter, men undermodul-rettigheter er en tilstandseksplosjon. Vent til en
  kunde faktisk ber om det.
- **Ett begrep, tre brukere.** Portalens grant har «omfang (hvilke moduler/kategorier)»,
  og mobilappens utvalg er et forvalg. Bygg én `Modultilgang`-type som medlemskap og
  grants deler.
- **Støtte for QR-flyten berøres ikke** — den er anonym og går ikke gjennom `orgRute`.

## Tester

- `tests/tilgang`-matrise: for hver modul, en bruker med `ingen` får 403 og en med
  `lesing` får 403 på skriving — generert fra `ALLE_MODULER`, ikke håndskrevet per modul.
- Registertester: AI-verktøy, søkekilder og widgeter uten modulmerking feiler.
- Arv: tom/`NULL` overstyring oppfører seg nøyaktig som i dag (regresjonsvernet).
- `orgadmin` med overstyring lagret (skal ikke kunne skje) ignorerer den.

## Byggerekkefølge

1. **Servergaten + `/api/meg`** — kolonne, importfri utregning, `krevNivaa`, tester. Ingen
   UI-endring; alle arver som før.
2. **Lekkasjeflatene** — AI, søk, dashboard, varsler. Må være på plass *før* noen kan
   sette en overstyring.
3. **Klienten** — `kan()`, omdøpingen som tvinger fram alle stedene, meny.
4. **Admin-UI** — forvalg + «Tilpasset»-rutenett, merke i brukerlista, hendelseslogg.

## Åpne spørsmål

- «Melde uten å se» for avvik — trengs den (se over)?
- Skal forvalg kunne lagres per org («Vaktmester»-profil), eller holder de tre + tilpasset?
- Skal en bruker se *at* det finnes moduler hen ikke har tilgang til, eller skal de være
  helt usynlige?
- Dokumentarkivet: holder modulnivå, eller kommer ønsket om mappe-/dokumentnivå først der?
