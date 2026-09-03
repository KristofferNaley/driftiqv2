# Fiken-integrasjon — designnotat

*Utkast 03.09.2026, basert på en lesende utforsking av Fiken API v2 med personlig nøkkel
mot et demoforetak. Ingenting er bygget. Notatet skal svare på «hva kan vi bruke Fiken
til, og hvordan må det bygges i v2» — ikke på om vi skal.*

## Hva som ble testet

- Konto `kristoffer@driftiq.no` i Fiken med demoforetaket «Fiken-demo - Venstre sky ESEK»
  (`testCompany: true`, opprettet 01.09.2026). Nøkkelen ligger i `/root/.fiken-api-nokkel`
  på VPS-en, utenfor repoet, og er **personlig** — se «Auth» under for hvorfor den ikke kan
  brukes i produktet.
- Alle lesekall svarte 200: foretak, bankkontoer, kontakter, produkter, kontoplan (514
  kontoer), kjøp, fakturaer, salg, bilag, transaksjoner, kreditnotaer, tilbud, innboks.
  `projects` svarte **402 «module not activated»** — modulstatus per foretak er altså noe
  koden må tåle.
- Demoforetaket var ved første lesing nesten tomt (to kontakter, to produkter, ingen kjøp),
  så formen på kjøp og EHF-dokumenter er lest fra den åpne spesifikasjonen
  (`https://api.fiken.no/api/v2/docs/swagger.yaml`), ikke fra ekte svar. Skal vi se
  ekte `purchaseResult`, må vi opprette testdata i demoforetaket — det er skrivekall, og
  en egen beslutning.

### Testdata opprettet 03.09.2026 (skrivekall, demoforetaket)

Felleskostnadsflyten ble testet ende til ende med personlig nøkkel, som sameiets eget
regnskap: produkt «Felleskostnader» (3 500 kr, konto 3601, `vatType: NONE`), fem
seksjonseiere som kunder (`memberNumberString` = `seksjon-1` … `seksjon-5`, alle med
e-post til Kristoffer), fem fakturaer 10001–10005 med forfall 17.09.2026, sendt med
`POST /invoices/send` (`method: ["email"]`, `emailSendOption: attachment`). Alt svarte
201/200. Én felle: `POST /invoices` gir **409 «invoice counter not initialized»** i et
foretak som aldri har fakturert — `POST /invoices/counter` (tom kropp eller `{"value":
10000}`) må kjøres først. Et ekte sameie som kobler seg til har alltid fakturert før, men
koden må tåle 409-en. Formen på `ehf` er fortsatt ulest fra ekte svar.

Samme dag ble leverandørsiden lagt inn: «Den beste vaktmesteren AS» som leverandør
(`supplier: true`) og fire kjøp à 5 000 kr brutto (4 000 + 25 % mva, konto 6795,
`kind: supplier`, `paid: false`, forfall den 15.) for september–desember med
`POST /purchases`. Fiken godtok fremtidig `date` også her. I tillegg «Demo Kraft AS» med fire strømkjøp (1 900–3 800 kr, konto 6341, 25 % mva,
forfall den 20.) og «Demo Forsikring AS» med én halvårspremie (12 000 kr, konto 7500,
uten mva), «Demo kommune» med kommunale avgifter per termin (T3 og T4: vann/avløp med mva,
feiing og eiendomsskatt uten — tre linjer per kjøp, 16 100 kr) og «Demo Renovasjon IKS»
per termin (6 500 kr), og «Demo Heisservice AS» med serviceavtale per halvår (12 500 kr) og én
utrykning med reservedel (4 375 kr, to linjer), begge konto 6620, og «Demo Rør AS» med to enkeltoppdrag uten avtale (lekkasje 5 725 kr,
hovedstoppekran 10 188 kr, konto 6600). Dermed finnes ekte
`purchaseResult` i demoforetaket, også med flere linjer og blandet mva: `supplier` er et innebygd kontaktobjekt, linjene har
`netPrice`/`vat`/`account`, og betalingsstatus ligger i `paid` + `settled`. Kun `ehf` er
fortsatt ulest fra ekte svar (krever en faktisk EHF-mottaker).

### Funn fra testrunden 03.09.2026 (det som ikke står i spesifikasjonen)

| Funn | Konsekvens |
|---|---|
| **`uuid` på faktura er IKKE idempotent.** Samme uuid sendt to ganger ga to fakturaer (10021/10022, kreditert). Utkast med samme `uuid` stoppes (ett utkast), men med **500 «duplikatfeil»**, ikke 409 — brukbart som siste skanse, ikke som design. | Idempotensen må ligge i DriftIQ: sett `orderReference = <units.id>:<ÅÅÅÅ-MM>` på hver faktura, slå opp `GET /invoices?orderReference=` før oppretting, og lagre Fiken-id-en lokalt i samme transaksjon. |
| **Regnskapsår må finnes i Fiken.** Faktura datert 2027 ga 400 «Fiscal year 2027 is invalid», og API-et har ingen rute for å opprette regnskapsår. | Halvårskjøringen 1.1 forutsetter at styret har åpnet nytt år i Fiken. DriftIQ må fange denne 400-en og si det i klartekst, før noe er sendt. |
| **Tellere må initialiseres**: både `invoices/counter` og `creditNotes/counter` gir 409 i et foretak som aldri har fakturert/kreditert. | Fang 409, kall counter, prøv igjen. Ekte sameier har som regel fakturert før, men ikke nødvendigvis kreditert. |
| **Kreditnota kan ikke dateres før fakturaen**, men fremtidig dato er OK (kreditnota datert 01.12 på faktura datert 01.12 gikk). Fakturaen får `associatedCreditNotes`, `sale.settled = true`, `outstandingBalance = 0`. | Eierskifte midt i halvåret: krediter resterende fakturaer med `issueDate` = fakturaens `issueDate`. |
| **Betaling registreres på salget**, ikke fakturaen: `POST /sales/{saleId}/payments` (`date`, `account` = bankkonto, `amount`). Etterpå `sale.settled = true`, `outstandingBalance = 0`; feltet `sale.paid` er alltid `null`. | Bruk `settled` og `outstandingBalance`, aldri `paid`. Normalt registrerer Fiken betalingen selv fra bankavstemming; DriftIQ skal ikke skrive betalinger. |
| **Utestående per eier** finnes to veier: `GET /invoices?customerId=&settled=false` (gir liste + `outstandingBalance` per faktura) og `GET /accountBalances/1500:<kundenr>` (én sum). Forfalt: `settled=false&dueDateLt=<i dag>`. | «Hvem har ikke betalt» er to kall, ingen speiling nødvendig for øyeblikksbildet. |
| **`accountBalances/{konto}?date=`** virker per konto og underkonto (3601 viste −70 000, 6320 45 200, 1920:10001 3 500). `bankBalances` var tom — den kommer fra bankintegrasjonen, ikke bokføringen. | Budsjett mot faktisk kan hentes som saldo per konto uten å speile kjøp — enklere enn synk for søyle 3. Speiling trengs bare for detaljene (per leverandør, per faktura). |
| **`lastModifiedGe` er en dato, ikke et tidspunkt** (17 treff i dag, 0 i morgen). | Inkrementell synk henter «siden i går» og dedupliserer på id. |
| **Rate limit:** 25 kall i burst tok 9,4 s, alle 200 — Fiken bremser, avviser ikke. | Sekvensielle kall holder; ingen 429-håndtering observert nødvendig, men behold en enkel kø. |
| PDF-nedlasting med bearer virker (`invoicePdf.downloadUrl`, 19 kB). `POST /inbox` med PDF gir 201. `PUT /contacts/{id}` virker for e-postendring. `dispatches` på fakturaen viser sendingene (`{date, dispatchType}`); `kid` var `null` på demoforetaket (KID krever avtale med banken). | Alt fase 3 og 4 trenger av skriving er bekreftet. KID/AvtaleGiro er fortsatt åpent. |
| **Ingen webhooks i API-et.** | All tilbakeføring er polling — bakgrunnsjobben er eneste vei. |

## Fakta om API-et som styrer designet

| Emne | Fakta | Konsekvens for v2 |
|---|---|---|
| Auth | To modeller: **OAuth2** (authorization code, `fiken.no/oauth/authorize` + `/token`, refresh tokens) og **personlige nøkler**. Fikens vilkår: personlig nøkkel i en tredjepartsapp gir umiddelbar utestengelse. | Produktet MÅ bruke OAuth. Personlig nøkkel kun til utvikling og curl. |
| App-registrering | En OAuth-app er registrert som «DriftIQ» under brukerinnstillinger. Utviklingsmodus tillater 5 brukere; produksjon krever søknad til `api@fiken.no`. «Kun lesetilgang» velges ved opprettelse og kan **ikke** endres etterpå. | Se «Lese- eller skriveapp» under. |
| Rate limit | Kall bremses over **4 forespørsler/sekund** per nøkkel. | En synkjobb over mange orger må køe og throttle — ikke `Promise.all`. |
| Beløp | Alle beløp er **heltall i øre** (`unitPrice: 150000` = 1 500,00). | Lagre som integer i øre, formatér med `felles.tsx`. Ingen flyttall. |
| Paginering | `page`/`pageSize` (maks 100) + svarheadere `fiken-api-page-count` og `fiken-api-result-count`. | Kontoplanen alene er 6 sider. Alle lister må pagineres. |
| Filtrering | `lastModifiedGe`/`createdDateGe` på det meste; kjøp har i tillegg `contactId`, `paid`, `settledDate*`, `date*`. | Inkrementell synk er mulig: hent bare det som er endret siden sist kjøring. |
| Identifikasjon | Foretak identifiseres med `slug`; kontakter har `organizationNumber` og et fritt `memberNumberString` «for å koble kontakten til egne data». | `memberNumberString` kan bære vår `vendors.id` — koblingen lever da i Fiken også. |
| Dokumenter | `documentUrl` (for API-nøkkel) og `…WithFikenNormalUserCredentials` (krever innlogget bruker). | Vis lenken som krever innlogging til brukeren; last ned via API kun i bakgrunnsjobb. |

## Hva Fiken har som passer DriftIQ

Ressursene under er de som treffer noe som allerede finnes i v2. Resten av API-et
(tilbud, ordrebekreftelser, timeføring, kreditnotaer) er uinteressant for et borettslag.

### Leverandører ↔ `contacts?supplier=true`

Fiken-kontakten har `organizationNumber`, `supplierNumber`, `bankAccountNumber`,
`email`, `inactive`. `vendors` har allerede `orgNumber`, `customerNumber`, `ehf` og
`invoiceReference`. Matching på normalisert orgnr (`lib/orgnr.ts`) er samme grep som
partnerregisteret i leverandørportal-notatet bruker, og kan gjøres ved lesing uten å
lagre noe. Verdi: leverandørkortet viser om leverandøren finnes i regnskapet, og siste
kjøp kan fylle `lastUsedAt` automatisk i stedet for manuelt.

### Leverandørfakturaer ↔ `purchases` og `ehf`

- `purchases` (`kind: supplier`, `supplierId`, `identifier` = fakturanr, `date`, `dueDate`,
  `paid`, `settled`, linjer med `netPrice`/`vat`/`account`, vedlegg med nedlastingslenke).
  Filtrerbar på `contactId`, så «alle kjøp fra Heisservice AS i 2026» er ett kall.
- `ehf` er innkomne EHF-fakturaer **før** de er bokført: `status` (`unprocessed` / `used` /
  `processed`), `supplierOrganizationNumber`, `supplierContactId`, `invoiceNumber`,
  `issueDate`, `dueDate`, `gross`, `kid`, og `purchaseId` når den er bokført. Dette er
  sannsynligvis den mest verdifulle enkeltressursen: **ubehandlede leverandørfakturaer med
  forfall** er noe et styre faktisk vil se, og `supplierOrganizationNumber` matcher rett
  mot `vendors.orgNumber` uten at kontakten trenger finnes i Fiken.

Verdi i v2: kontraktkortet får «budsjett vs. faktisk» (`contracts.annualSum` mot summen
av kjøp fra leverandøren i året), leverandørkortet får faktisk kostnad, og
vedlikeholdsplanen kan få `cost` fylt fra bokførte kjøp i stedet for manuelt.

### Økonomioversikt ↔ `accountBalances` og `bankBalances`

Saldo per konto på en dato (`fromAccount`/`toAccount`/`date`) og banksaldo per konto i
øre. Nok til et KPI-kort på dashbordet («bankinnskudd», «driftskostnader hittil i år»)
uten å hente ett eneste bilag. Billig, lesende, lav risiko.

### Innboks ↔ leverandørportalen (senere)

`POST /inbox` tar `multipart/form-data` (`name`, `filename`, `description`, `file`) og
legger et dokument i Fikens innboks «til bokføring». Når leverandørportalen finnes, kan
en servicerapport eller faktura lastet opp av leverandøren gå rett til borettslagets
innboks. Det er første og eneste skriveflyt som virker opplagt — og den er ufarlig, fordi
innboksen ikke bokfører noe; regnskapsføreren gjør det.

### Felleskostnader ↔ `invoices`

Sameier fakturerer **et halvt år om gangen**, batch per 1.1 og 1.7 med satsjustering, én
faktura per måned per seksjon med forfall den 15. Testen 03.09.2026 viste at det kan
gjøres med `POST /invoices` i løkke: Fiken godtar **fremtidig `issueDate`**, så hele
halvåret legges inn på én gang. `recurringInvoices` passer dårligere (fast sats, ingen
justeringsdato). Hvordan dette blir en del av produktet står i «Økonomimodulen» under.

## Premiss: dette er for sameier, helst små

Borettslag har i praksis alltid forretningsfører — tilknyttede lag har boligbyggelaget som
forretningsfører gjennom vedtektene, og frittstående bruker et regnskapsbyrå. Regnskapet
ligger da hos forretningsføreren, ikke i et Fiken styret selv eier. (Om det er et lovkrav
er ikke sjekket; det endrer ikke konklusjonen.) Sameier velger selv — eierseksjonsloven
lar årsmøtet *vedta* forretningsfører — og små sameier fører gjerne regnskapet selv, ofte
nettopp i Fiken.

Målgruppen er derfor **selvadministrerte sameier**: `organizations.managerType =
"selvadministrert"`. Det gir noen føringer for designet:

- **Små styrer, få brukere.** Koblingen må kunne settes opp av én person på ti minutter
  uten regnskapskunnskap. Fase 1 skal ikke kreve at brukeren forstår kontoplanen.
- **Færre EHF-fakturaer, flere PDF-er på e-post.** `purchases` (bokførte kjøp) er trolig
  viktigere enn `ehf` i dette segmentet, og innboksflyten i fase 3 blir mer verdt.
- **Standard, ikke tillegg.** Avklart 03.09.2026: økonomimodulen er grunnpakke for
  sameier — det er den som vinner dem, se «Posisjonering».
- **Segmentstørrelsen** telles fra `managerType` i prod før prioritering; tallet hører
  ikke hjemme her.

## Én app med skrivetilgang

Første tanke var en ren leseapp som løfte til kunden. Med felleskostnader i kjernen
faller den: fakturering er skriving fra dag én. Løftet flyttes i stedet inn i DriftIQ og
håndheves i koden: **DriftIQ oppretter fakturaer, kreditnotaer og innboksdokumenter i
Fiken — bokfører aldri kjøp, sletter aldri, endrer aldri noe det ikke selv har laget.**
`tests/fiken.test.ts` skal ha en liste over tillatte endepunkt+metode, og klienten
nekter alt annet. Fiken-appen «DriftIQ» beholdes slik den er registrert (uten
«Kun lesetilgang»).

## Økonomimodulen — DriftIQ styrer, Fiken fører

*Lagt til 03.09.2026 etter samtale: en egen «Økonomi»-fane der budsjettet er grunnlaget
for å sende felleskostnader direkte fra DriftIQ.* Dette flytter felleskostnader fra
«senere» til kjernen, og snur rekkefølgen under.

**Prinsippet:** DriftIQ fører aldri regnskap. Budsjett, brøk, sats og fakturagrunnlag
lever i DriftIQ. Bokføring, utsending, betalingsoppfølging, purring og årsoppgjør lever i
Fiken. DriftIQ *oppretter fakturaene i Fiken* via API og lar Fiken sende dem. Da har
DriftIQ ingen bokføringsplikt, alt er avstembart i Fiken, og regnskapsføreren ser det samme
som styret.

### Posisjonering: styreportalen uten forretningsfører

Med eierregister, budsjett, felleskostnader og «faktisk» på plass er DriftIQ det
forretningsførerne (OBOS, Vestbo, BOB, regnskapsbyråene) gir styrene sine som portal —
men for sameier som *ikke* har forretningsfører, og til en brøkdel av prisen. Det er
den egentlige produktdefinisjonen for økonomimodulen, ikke «Fiken-integrasjon».

**Idealkunden** er sameiet som er lite nok til å klare seg uten forretningsfører, men
som likevel må føre regnskap, holde orden på eierne og fakturere felleskostnader. For
dem er økonomimodulen ikke et tillegg, men grunnen til å velge DriftIQ — den er
**standard i grunnpakken** og selve kroken for å vinne dem. Eierseksjonsloven skiller på
antall seksjoner for regnskaps- og revisjonsplikt; grensene bør slås opp og brukes til å
tegne segmentet presist (hvor stort kan et sameie være før forretningsfører blir
normen?).

To følger: (1) Forretningsførerne er både konkurrenter og mulig kanal. Et byrå som fører
regnskap for ti små sameier kan bruke DriftIQ som sin portal og få eierregister,
fakturagrunnlag og drift i samme flate — det er «virker uten Fiken»-sporet under, og det
bør ikke bygges bort. (2) Selvforvaltede sameier mangler i dag akkurat dette laget; de
har Fiken (eller et regneark) og en e-postliste. Det er et tomrom, ikke et marked vi må
ta fra noen.

### DriftIQ eier grunndataene

Seksjoner, brøk og **eiere med historikk** er DriftIQs data, ikke regnskapssystemets.
Regnskapssystemet får kopier (kontakter opprettet av DriftIQ, merket med `units.id`), og
byttes regnskapssystem, følger grunndataene med. Det er det som gjør at styret kan lage
budsjett for 2027 i DriftIQ høsten 2026 og få sats per seksjon ut av det — uansett hvor
regnskapet føres.

Kontoene i budsjettet følger **Norsk Standard kontoplan (NS 4102)**, ikke Fikens
kontoliste. Fiken, Tripletex og forretningsførernes systemer bruker alle samme
firesifrede nummerserie (6320, 6341, 6600, 7500 …), så budsjettlinjene kan matches mot
hvilket som helst av dem. Regnskapskoblingen blir et **adapter** bak ett grensesnitt
(`opprettKontakt`, `opprettFaktura`, `sendFaktura`, `hentKjop`, `hentBetalinger`,
`opprettKreditnota`) med Fiken som første implementasjon og Tripletex som neste —
Tripletex har eget API med annen auth (session token fra consumer- og employee-token),
men samme dataformer. Ingen Fiken-spesifikke felt i DriftIQs egne tabeller; Fiken-id-er
ligger i adapterets egne koblingstabeller.

### Tre søyler

1. **Budsjett** per regnskapsår. Linjer per kostnadsgruppe, hver med et Fiken-
   kontointervall (6320 kommunale avgifter, 6341 strøm, 6600/6620 vedlikehold, 6795
   vaktmester, 7500 forsikring …) og et beløp. Inntektssiden er felleskostnader pluss
   annet. Vedlikeholdsplanens `estimatedCost` kan flyte inn som egen linje. Status
   utkast → vedtatt (årsmøtedato), og vedtak låser satsene.
2. **Felleskostnader.** Sats per seksjon = vedtatt inntektsbehov × brøk / 12, rundet til
   hele kroner, med overstyring per seksjon (garasje, bod, tillegg). Kjøres per halvår
   (1.1 og 1.7): én handling lager seks fakturaer per seksjon i Fiken med fremtidig
   `issueDate` og forfall den 15. — bevist mulig 03.09. Betalingsstatus leses tilbake fra
   Fiken (`invoices` → `settled`, `sales/{id}/payments`) og gir «hvem har ikke betalt»
   uten at DriftIQ rører en krone.
3. **Faktisk.** Kjøp speilet fra Fiken, gruppert på budsjettlinjenes kontointervall →
   budsjett mot faktisk per linje, årsprognose, og per leverandør på leverandørkortet.

### Nye data i DriftIQ

- `units.brok` (teller/nevner, sameiebrøk) — finnes ikke i dag; `units` har bare nummer,
  oppgang og etasje.
- **Eier per seksjon** med navn, e-post og fakturaadresse — også nytt, og det første
  stedet DriftIQ lagrer personopplysninger om beboere systematisk. Trenger
  behandlingsgrunnlag i vilkårene, eierskifte som egen handling (gammel eier
  arkiveres, ikke slettes — fakturahistorikken peker på hen) og eksport/sletting ved
  forespørsel. Fiken-kontakten opprettes av DriftIQ med `memberNumberString = units.id`,
  så koblingen overlever navnebytte. **Avklart 03.09.2026:** sameiet får en egen
  databehandleravtale der DriftIQ er databehandler og sameiet (styret)
  behandlingsansvarlig, og avtalen nevner eksplisitt eiere med navn, e-post, telefon og
  seksjon. Gevinsten for styret er at eierregisteret ligger samlet ett sted, sammen med
  resten av driften — det er et salgsargument i seg selv, ikke bare et vilkår.
- `budgets` / `budget_lines`, `unit_fee_rates` (sats per seksjon med gyldig-fra),
  `fee_runs` (halvårskjøring: periode, hvem, opprettede Fiken-faktura-id-er) — alle org-
  eide med RLS, og kjøringen i hendelsesloggen.

### Virker uten Fiken

Søyle 1 og satsberegningen trenger ingen kobling. Uten Fiken eksporteres
fakturagrunnlaget (CSV/PDF per halvår) til forretningsfører eller annet system. Det gjør
modulen salgbar til borettslag også — de vil ha budsjett og «faktisk» selv om BBL
fakturerer — og Fiken-koblingen blir utsendingskanal og tilbakeføring for de
selvadministrerte. Segmentproblemet (én selvadministrert kunde i dag) blir da mindre.

### Kanter som må designes, ikke oppdages

- **Eierskifte midt i halvåret:** resterende fakturaer til gammel eier krediteres i
  Fiken (`creditNotes/full`) og lages på nytt til ny eier. Én handling i DriftIQ.
- **Satsendring midt i perioden** (ekstraordinært årsmøte): samme mekanikk, kreditnota
  + ny faktura for resten av perioden.
- **Mva aldri på felleskostnader:** `vatType: NONE`, inntektskonto 3601 — låst i koden,
  ikke valgbart.
- **Sameiet er normalt ikke mva-registrert.** Felleskostnader er ikke omsetning, og et
  eierseksjonssameie er utenfor mva-området med mindre det har avgiftspliktig omsetning
  over grensen (utleie til utenforstående, frivillig registrering for næringsleie o.l.).
  Da er inngående mva en **kostnad**: kjøp føres med `vatType: NONE` og hele
  bruttobeløpet som kostnad, og «faktisk» i budsjettet er alltid det sameiet betaler,
  ikke netto. Adapteret leser foretakets `vatType` fra `GET /companies` og velger
  føring etter det. Demoforetaket er (ved en feil) registrert med tomånedlig mva-termin,
  så kjøpene fra 03.09 er ført med 25 % splitt slik et registrert foretak ville gjort —
  det er ikke slik et sameie skal se ut. Demoforetaket ble derfor satt til ikke
  mva-registrert samme dag, og alle 17 kjøp ført på nytt med brutto som kostnad
  (`PATCH …/purchases/{id}/delete` setter bare `deleted` og lager en motpostering — de
  gamle radene finnes fortsatt i `GET /purchases` med `deleted: true`). Testfakturaene
  var riktige fra før (uten mva).
- **KID/AvtaleGiro:** Fiken setter KID; om AvtaleGiro-trekk kan startes via API er
  uavklart. Mange eiere betaler felleskostnader med AvtaleGiro — sjekk før fase 3.
- **Idempotens:** kjøringen må kunne kjøres om igjen etter avbrudd uten dobbeltfakturaer.
  Fikens `uuid` hjelper ikke (testet — se funnene), så nøkkelen er `orderReference` per
  seksjon+måned med oppslag før oppretting, og lokal lagring av Fiken-id i samme
  transaksjon.

## Del 2: DriftIQ fakturerer sine egne kunder fra plattformpanelet

*Lagt til 03.09.2026.* Et annet forhold til Fiken enn resten av notatet: her er DriftIQ
(selskapet) Fiken-kunden, og kundene i plattformpanelet er kontaktene. Målet er at
kundedata og kontrakt flyter fra panelet til Fiken automatisk, at faktura kan sendes
fra panelet, og at ingenting kopieres for hånd — mens panelet forblir stedet kontrollen
ligger.

**Auth er enklere her:** ett foretak (DriftIQs eget), én personlig API-nøkkel er innenfor
Fikens vilkår («Fiken customers that wish to integrate their own solutions»). Ingen
OAuth, ingen tokenlagring per org — nøkkelen er en plattform-env (`FIKEN_PLATTFORM_NOKKEL`,
`FIKEN_PLATTFORM_SLUG`), koblet gjennom `docker-compose.yaml`. Merk: DriftIQ AS finnes
ikke ennå (Trodlaskar Holding AS → DriftIQ AS); foretaket i Fiken må være det som
faktisk fakturerer.

**Datamodell:** `organizations` er allerede master (navn, `orgNr`, `contactEmail`,
`unitCount`), og `platform_contracts` har alt en faktura trenger (`baseFee`, `modules` med
pris, `discountPercent`, start/slutt). Nytt: `fiken_contact_id` og `fiken_synced_at` på
organisasjonen (UNNTATT-tabell, plattformlaget), og en `platform_invoices`-tabell
(org, kontrakt, periode, Fiken-`invoiceId`/-nummer, beløp, `orderReference`, status lest
tilbake). Alt i `withoutRls("plattformpanel")` via `plattformRute` — ingen org-kontekst,
og det er riktig her fordi tabellene er plattformens egne.

**Flyt:**

1. Kunde opprettes/endres i panelet → `etterCommit`: opprett eller oppdater Fiken-kontakt
   (`customer: true`, `organizationNumber` = orgnr, `memberNumberString` = `organizations.id`,
   `daysUntilInvoicingDueDate` = 30). Oppslag på `memberNumberString` før oppretting, så
   kontakten aldri dobles.
2. «Send faktura» på kundekortet: linjer bygges av kontrakten — grunnpakke som én linje
   (`grunnpakkeSpesifisert` kan gi trinnene som beskrivelse), én linje per tilleggsmodul,
   `discount` = `discountPercent` per linje. `orderReference = <orgId>:<periode>`,
   oppslag først (idempotens, se funnene). Sendes med `POST /invoices/send`
   (`method: auto` — EHF til de som kan ta imot, ellers e-post). Fakturaen lagres i
   `platform_invoices` og hendelsesloggen.
3. Bakgrunnsjobb daglig: `GET /invoices?settled=false` mot foretaket, oppdater status —
   panelet viser betalt/forfalt per kunde uten at noen logger inn i Fiken.

**Testet 03.09.2026** i et eget demoforetak som spiller DriftIQ («Fiken-demo - Alvorlig
lys AS», mva-registrert): «DEMO - Sammen Sameie» opprettet som kunde med
`memberNumberString` = org-id (oppslag på id virker), faktura 1002 på grunnpakken alene
(8 000 + 25 % mva = 10 000 kr, konto 3000, `orderReference = <orgId>:2026`), sendt på
e-post. Tre funn underveis:

- **Faktura med 100 % rabatt avvises** («total gross amount must be positive»). Begge
  demoavtalene i panelet har 100 % rabatt — gratisavtaler må hoppes over, ikke faktureres.
- **`orderReference`-oppslaget må se bort fra krediterte fakturaer** (de har
  `associatedCreditNotes`), ellers stopper en ny faktura for samme periode etter en
  kreditering. Første forsøk (1001, alle moduler) ble kreditert og erstattet nettopp slik.
- Teller for faktura *og* kreditnota måtte initialiseres også her.

Det første forsøket havnet i sameiets foretak (Venstre sky) og er kreditert der og
kontakten deaktivert — en påminnelse om at Del 1 og Del 2 aldri skal dele foretak.

**Det som skiller Del 2 fra sameie-siden:** mva. DriftIQ AS er (blir) mva-registrert, så
linjene skal ha `vatType: HIGH` og inntektskonto 3000; demoforetaket er nå
uregistrert, så testen brukte `NONE`/3900. Konto og mva-type hører hjemme i
prismodellen (`pricing_config`), ikke hardkodet.

## Hvordan det må bygges i v2

Følger mønstrene i CLAUDE.md; det som er spesielt for Fiken står i kursiv.

- **Modul** `okonomi` i `ALLE_MODULER` + `MENY`, **PÅ som standard** (ikke i
  `AV_SOM_STANDARD`; grunnpakke, se posisjonering) — merk kommentaren i `moduler.ts` om at
  «av som standard» og «tilleggsmodul» i dag er samme sett, så det er første modul som
  skiller dem. `modul: "okonomi"` på alle ruter uansett, så en org kan slå den av.
- **Tabeller**: `fiken_connections` (org-eid, `DIREKTE_TABELLER`): `companySlug`,
  `companyName`, kryptert `accessToken`/`refreshToken`, `tokenExpiresAt`, `scope`
  (lese/skrive), `connectedBy`, `lastSyncAt`, `lastSyncError`. Én rad per org — *aldri
  token i `organizations`*. Speilede data (`fiken_purchases`, `fiken_ehf_documents`) er
  org-eide tabeller med `fikenId` + `orgId` som unik nøkkel. *Token-kryptering er nytt i
  v2: nøkkel i env (`FIKEN_TOKEN_KEY`), koblet gjennom `docker-compose.yaml`.*
- **OAuth-flyt**: `orgadmin` starter koblingen fra orginnstillinger; callback-ruten på
  `app.driftiq.no/api/okonomi/fiken/callback` (registrert i Fiken-appen) bytter kode mot
  token og skriver raden i `withOrg`. `state` bærer `orgId` signert, ellers kan en
  callback lande i feil org. Redirect etter callback bygges fra `Host`, ikke `req.url`.
  Kobling og frakobling logges med `loggHendelse` (tilgangsendring).
- **Synk som bakgrunnsjobb** i `instrumentation.ts` med begge gatene og
  `{ timezone: "Europe/Oslo" }`, registrert i `JOBBER`. Går gjennom orgene med kobling én
  om gangen i `withOrg(orgId)` — `withoutRls("bakgrunnsjobb")` kun for å finne dem.
  *Throttle til under 4 kall/s totalt, og bruk `lastModifiedGe` fra `lastSyncAt`.* Feil
  per org lagres på raden og varsles via `sendDriftsvarsel`, ikke kastet.
- **Utadrettede kall** fra en handler (koble til, «synk nå») går i `etterCommit`.
  Lesekall i sanntid mot Fiken fra en side bør unngås — vis speilet, og la jobben hente.
- **Klient**: `okonomi`-objekt i `lib/klient.ts`, `useOrgData` på sidene, beløp
  formatert fra øre i `felles.tsx`.
- **Tester**: krysstest i stil med `tests/ai.test.ts` — org A ser aldri org Bs kjøp, og
  synkjobben skriver aldri utenfor `withOrg`. Tokenrad-tabellen inn i `tests/rls.test.ts`
  via registeret.
- **Testmiljø først.** Alt over rører prod-basen og en ekstern tjeneste. Bygges ikke før
  testmiljøet på VPS-en finnes (README «Neste steg» 4).

## Foreslått rekkefølge (revidert 03.09.2026)

1. **Økonomi uten Fiken**: brøk og eier på seksjon, budsjett med kontointervall, sats
   per seksjon, eksport av fakturagrunnlag. Ingen ekstern avhengighet, selgbart alene.
2. **Fiken-kobling, lesing**: OAuth, tokenlagring, synk av `purchases` → «faktisk» mot
   budsjettlinjene, og leverandørkortet. Beviser kobling og synk med lav risiko.
3. **Felleskostnader via Fiken**: halvårskjøringen oppretter og sender fakturaer,
   betalingsstatus tilbake. Krever kantene over. Søknad om produksjonsstatus hos Fiken
   sendes når dette er klikkbart i test.
4. **Innboks fra leverandørportalen** når portalen finnes.

## Utvikling og testing uten å røre prod

Personlig nøkkel + demoforetak, rett fra verten:

```bash
curl -sS -H "Authorization: Bearer $(cat /root/.fiken-api-nokkel)" \
  "https://api.fiken.no/api/v2/companies/fiken-demo-venstre-sky-esek/contacts?supplier=true"
```

Spesifikasjonen og alle svarene fra 03.09.2026 ligger ikke i repoet; hent spesifikasjonen
på nytt fra adressen over ved behov. OAuth-appens client id/secret hører hjemme i
test-`.env`, aldri i chat eller commit.

## Åpne spørsmål

- Segmentet: finnes det selvforvaltede kunder i dag? (Se premisset over.)
- Skal speilede kjøp være synlige for `visning`-nivået, eller kun `orgadmin`? Regnskap er
  mer sensitivt enn oppgaver.
- Oppbevaring: hvor lenge beholdes speilet etter frakobling? Forslag: slettes ved
  frakobling, med hendelse i loggen.
- Fikens produksjonsgodkjenning: søknaden til `api@fiken.no` bør sendes når fase 1 er
  klikkbar i test, ikke før.
