# BIR — tømmedager på oppslagstavla

*Bygget 29.09.2026. BIR (Bergensområdets Interkommunale Renovasjonsselskap) har ikke noe
dokumentert API; integrasjonen bruker de samme flatene som bir.no. BIR er ikke spurt ennå
— se «Åpent» nederst.*

## Hva det gjør

Orgadmin søker opp borettslaget hos BIR og velger oppføringen (Oppslagstavle → Skjermer og
utseende → «Tømmedager fra BIR»). DriftIQ henter tømmekalenderen ved kobling, med «Hent nå»
og hver natt kl. 02:40 (jobben «bir-synk»), og lagrer datoene. Skjermen viser neste tømming
per fraksjon i feltet «Tømmedager» — det slås på per skjerm, og er skjult når orgen ikke er
koblet. Skjermen spør aldri BIR selv.

## Hvorfor styret VELGER oppføringen

Borettslag med fellesløsning er en egen oppføring hos BIR, og søket treffer selskaper:
«håsteinsgate 9» gir «Borettslaget Håsteinsgate 9» (Bergen, eiendom 4601.153.217.0.2).
En adresse inne i laget kan gi en annen henteordning. Derfor ingen automatisk kobling fra
adressen.

## Flatene hos BIR (hvitelista i `lib/bir.ts`)

| Kall | Svar |
|---|---|
| `GET /api/search/AddressSearch?q=…&s=false` | JSON: `[{ Title, SubTitle, Id, RealEstateId, AgreementType, Url }]` |
| `GET /adressesoek/toemmekalender/?rId=<Id>` | HTML, tre måneder fram |

Kalenderen tolkes slik (`tolkKalender`): `.month-container` → `h2.month-title` («Oktober
2026») gir år og måned; hver `.category-row` har fraksjonen BARE som ikonfil
(`/css/assets/trashicons/restavfall.svg`), og datoene i `.date-item-date` («5. okt»).
Ikonnavn → fraksjon står i `BIR_IKON` i `lib/avfallsregler.ts`; et ukjent ikon beholdes med
ikonnavnet i stedet for å forsvinne. `tests/fixtures/bir-toemmekalender.html` er et ekte
utsnitt (29.09.2026).

## Det som er lett å gjøre feil

- **Skraping ryker stille hvis man lar den.** Finner `tolkKalender` ingen måneder eller en
  ukjent månedsoverskrift, KASTES `BirFeil` — en tom liste ville sett ut som «ingen tømming».
- **Feil noteres og returneres, de kastes ikke** (`synkBir`). Kastet den, rullet
  transaksjonen tilbake og tok `last_error` med seg (samme felle som Easee). De sist kjente
  datoene står til de er passert; feilen vises i kortet og samles i ett driftsvarsel.
- Nettfeil mot BIR er 503, aldri 502/504 (CLAUDE.md «Fallgruver»).
- `rId` valideres som GUID før den sendes — den kommer fra databasen, men går inn i en URL.

## Fjernbar pakke

| Del | Fil(er) |
|---|---|
| Skjema | `src/db/schema/bir.ts` (+ én linje i `index.ts`), `drizzle/0062_bir.sql` |
| RLS | `bir_settings`, `bir_pickups` i `DIREKTE_TABELLER` |
| HTTP + tolkning | `src/lib/bir.ts` |
| Fraksjoner (importfri) | `src/lib/avfallsregler.ts` |
| Logikk | `src/lib/birkobling.ts` |
| Ruter | `src/app/api/organizations/[orgId]/oppslagstavle/bir/**` |
| Klient | `bir`-blokken nederst i `src/lib/klient.ts` |
| UI | `src/app/(app)/oppslagstavle/BirKort.tsx`, `.ot-avfall`/`.ot-sone-avfall` i `globals.css` |
| Jobb | «bir-synk» i `lib/jobber.ts` og `instrumentation.ts` |
| Tester | `tests/bir.test.ts`, `tests/fixtures/bir-toemmekalender.html` |
| Koblinger inn i resten | `tommedagerForSkjerm` i `byggSkjerminnhold` (lib/oppslagstavle.ts); `"avfall"` i `FELT` og `avfall` i `Skjerminnhold` (oppslagstavleregler.ts); avfallssonen i `Tavleskjerm.tsx`; `<BirKort />` i oppslagstavle-siden |

### Slik fjernes den

1. Ny migrasjon som dropper `bir_pickups` og `bir_settings`.
2. Slett filene over; fjern tabellnavnene fra `rls/tables.ts`, linja i `schema/index.ts`,
   `bir`-blokken i `klient.ts`, jobben i `jobber.ts`/`instrumentation.ts`.
3. Fjern koblingene inn i resten (siste rad i tabellen). `lesFelt` ignorerer ukjente
   feltnøkler, så lagrede skjermer med `"avfall"` virker videre.

## Åpent

- **Spør BIR.** Nettsiden er ikke et API vi har avtale om. BIR-appen henter samme data et
  sted fra; et ordentlig API (eller en tillatelse) bør på plass før dette selges bredt.
  Belastningen er ett kall per koblet borettslag per natt.
- Andre renovasjonsselskap (utenfor BIR-kommunene) får samme form: en adapter som gir
  `Tommedag[]`, og samme `bir_pickups`-lignende lagring. Da bør tabellene få et nøytralt
  navn — ikke gjør det før selskap nummer to finnes.
