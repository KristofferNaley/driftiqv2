# Oppslagstavle — infoskjermer i oppgangen

*Etappe 1 bygget 29.09.2026. Mockupen (claude.ai-artefakt «DriftIQ Oppslagstavle») er
layoutintensjon, ikke fasit — fasiten for farger i appen er tokenene i `globals.css`.*

## Idéen

Styret legger ut oppslag (tekst, bilde) og hendelser i DriftIQ; skjermer i oppgangen viser
dem innen ett minutt. Skjermen er en nettleser i fullskjerm på `/skjerm` — ingen konto, bare
et enhetstoken den får ved kobling. Tilleggsmodul (`oppslagstavle`, av som standard).

## Slik det er bygget (etappe 1)

| Del | Hvor |
|---|---|
| Tabeller | `src/db/schema/oppslagstavle.ts` — `board_screens`, `board_posts`, `board_post_pages`, `board_events`, `board_settings`, `board_contacts`, `board_blocks` (DIREKTE), `board_pairings` (UNNTATT). `board_placements` er utgått og leses bare av migreringen |
| Logikk | `src/lib/oppslagstavle.ts` |
| Regler, typer, palett (importfri) | `src/lib/oppslagstavleregler.ts` |
| Maler og felt (importfri) | `src/lib/tavlemaler.ts` |
| Bilder og PDF → WebP-sider | `src/lib/tavlebilder.ts` (vips og pdftoppm fra imaget) |
| Migrering plassering → felt | `src/lib/tavlemigrering.ts`, kjørt av `scripts/oppstart.ts` |
| Vær- og avgangsblokker | `src/lib/tavleblokker.ts` — se `docs/entur-yr.md` |
| Styrets API | `/api/organizations/{orgId}/oppslagstavle/…` via `orgRute` |
| Skjermens API (anonymt) | `/api/skjerm/kobling`, `/kobling/status`, `/innhold`, `/side/{sideId}`, `/kontakt/{id}`, `/logo` |
| Adminside | `src/app/(app)/oppslagstavle/` — `page.tsx` (utkast, lagrelinje, første gangs oppsett, forhåndsvisning), `Innhold.tsx` (lista og panelet), `Bildesider.tsx`, `Oppsett.tsx`, `Feltkart.tsx`, `Blokker.tsx`, `BirKort.tsx`, `Kontaktpersoner.tsx` |
| Skjermen | `src/app/skjerm/page.tsx` + `src/components/Tavleskjerm.tsx` (samme komponent i forhåndsvisningen) |

### Kobling

1. Skjermen åpner `/skjerm`, ber om kode (`POST /api/skjerm/kobling`) og får `kode` +
   `hemmelighet`. Koden (6 tegn, uten 0/O/1/I/L) vises; hemmeligheten blir i skjermen.
2. Orgadmin skriver koden inn under «Koble til skjerm». Det oppretter `board_screens`-raden
   og setter `board_pairings.screen_id`. Ukjent, utløpt og allerede brukt kode gir samme
   melding.
3. Skjermen spør hvert 3. sekund med hemmeligheten. Når koden er brukt, får den et ferskt
   token — én gang; koblingsraden slettes i samme transaksjon.
4. Koden utløper etter 15 minutter; skjermen henter da en ny. Utløpte rader ryddes ved neste
   `startKobling`.

### Tokenet og RLS

Tokenet er 32 tilfeldige byte; bare sha256 lagres. Skjermruta slår opp tokenet med
`withoutRls("skjerm")` — ett oppslag på én kolonne, som også skriver livstegnet
(`last_seen_at`) — og kjører deretter ALT annet i `withOrg(orgId)` som en vanlig rute.
`sideForSkjerm` gir bare bilder fra oppslag skjermen selv skal vise. Fjernes skjermen i appen,
svarer neste henting 401 og skjermen går tilbake til koblingsbildet.

### Oppslag, visningstid og typer

To typer: **tekst** og **bilder**. Hvert oppslag har egen visningstid (`display_seconds`), og
skjermen bruker en timeout per oppslag, ikke et fast intervall. Typen står fast etter at
oppslaget er laget. For tekst styrer viktig/informasjon/arrangement BARE merkelapp og
kantfarge, ikke rekkefølge eller tid.

Reglene for et oppslag (lengder, datoer, visningstid) er `oppslagFeil` i den importfrie
`oppslagstavleregler.ts`. Skjemaet kaller den før innsending og serveren i Zod-skjemaet, så de
aldri er uenige. Teksten er maks 200 tegn (var 400 til 30.09.2026); eldre, lengre tekster
vises som før, men må kortes ned når de redigeres.

### Bilder og PDF (30.09.2026)

Et bildeoppslag er en **ordnet liste med sider** (`board_post_pages`), og en side er alltid
et bilde. Maks `MAKS_SIDER` (10) per oppslag.

- **Opplasting**: JPG, PNG, WebP, HEIC og PDF, inntil 20 MB per fil, én fil per kall med
  fremdrift (`lastOppMedFremdrift` i klient.ts). `filFeil` er samme kontroll i skjemaet og på
  serveren. En fil som feiler, stopper ikke de neste.
- **Konvertering** (`lib/tavlebilder.ts`): alt blir WebP, maks 3840 px på lengste side. En PDF
  deles i ett bilde per side og er ikke en egen enhet etterpå — sidene kan flyttes og
  fjernes enkeltvis. En PDF med flere sider enn det er plass til, avvises HEL med antallet
  som får plass. Originalfilene lagres ikke; kvoten regnes av WebP-filene.
- **Kladd**: et nytt bildeoppslag opprettes som kladd (`board_posts.draft`) idet første fil
  lastes opp. Kladder vises verken i lista eller på skjermene. «Legg ut» er `endreOppslag`
  (krever minst ett bilde), «Avbryt» sletter kladden, og kladder som blir liggende, ryddes av
  nattjobben «hendelsesrydding» etter 24 timer (`ryddKladder`).
- **Per bilde**: valgfri bildetekst (maks 80 tegn, vises under bildet), fokuspunkt i prosent
  (`object-position` når bildet beskjæres), og tilpasning: `dekk` fyller feltet, `hele` viser
  hele bildet. Sider fra PDF får `hele` — et lysbilde skal ikke beskjæres.
- **Lagres straks**: filer, rekkefølge, bildetekst, fokuspunkt og fjerning går rett til
  serveren, også på et oppslag som allerede er lagt ut. Resten av skjemaet venter på knappen.
  «Fjern» har fem sekunders angrefrist i klienten før slettingen sendes.
- **Visning**: «Bla gjennom bildene» (myk overgang, `sekunder` per bilde) eller «Rutenett»
  (opptil fire samtidig). Skjemaet kan ikke vite hvor stort feltet er — samme oppslag går til
  flere skjermer — så SKJERMEN avgjør: rutenett bare når feltet er minst 45 % av bredden og
  40 % av høyden (`useStortFelt`), ellers blas bildene gjennom.
- **Ingen blinking**: et bildeoppslag er med i rotasjonen først når alle bildene er lastet
  (`sideUrl` gir `null` til da), og sidene ligger oppå hverandre så neste bilde er dekodet.
- Sekunder per bilde har egen liste (`BILDESEKUNDER`: 5, 8, 12, 20; standard 8). Et oppslag
  med en tid utenfor lista beholder den til den endres.

**Migreringen** (SQL i `drizzle/0067`): bildeoppslag fra før hadde ett bilde i selve raden.
Hvert fikk én side som peker på samme fil, uten konvertering, med tittelen som bildetekst.
Filkolonnene i `board_posts` er tømt (ellers telles fila to ganger i kvoten) og brukes ikke.

### Panelet «Nytt innhold»

Nytt innhold og redigering er samme komponent (`OppslagSkjema`), en `Skuff` uten slør fra
høyre. Forhåndsvisningen står synlig ved siden av og viser utkastet mens man skriver: siden
legger `Innholdsutkast` inn i oppslagene eller kalenderen skjermen tegner, og låser
rotasjonen til utkastet. Under 1100 px tar panelet hele bredden, med «Forhåndsvis» som
veksler mellom skjema og skjerm. Knappene står i skuffens faste fot.

### Maler og felt (lagt om 30.09.2026)

HVA som vises HVOR, velges **per skjerm**: skjermen har en mal, og hvert felt i malen har en
liste med blokker. Innholdet selv (oppslag, kalender) vet ikke hvor det står.

- **Mal** (`MALER` i `lib/tavlemaler.ts`, 5–6 per retning): ett stort felt `a`, null til tre
  små (`b`–`d`) og stripen. `board_screens.layout`.
- **Felt** (`board_screens.zones`, JSON): `{ a: ["oppslag"], b: ["kalender"], stripe: [...] }`.
  Verdiene er blokknøkler — de innebygde (`oppslag`, `kalender`, `kontakt`, `tommedager`)
  eller `blokk:<id>` for vær og avganger (`board_blocks`, `docs/entur-yr.md`). Flere nøkler i
  ett felt roterer (`SONE_SEKUNDER`); stripen viser sine kompakt, side om side. En tom stripe
  tar ingen plass.
- **Kartet** (`Feltkart.tsx`) under «Skjermer og oppsett» viser feltene. Klikk på et felt
  åpner velgeren; et felt uten innhold står som «Velg innhold», og skjermkortet teller felt
  uten innhold (tomme, eller bare blokker som mangler oppsett — tømmedager uten BIR).
  Forhåndsvisningen rammer inn feltet som er valgt.
- **Oppsettet for det som står i feltet** (vær og avganger, BIR, kontaktpersoner) vises under
  kartet når feltet er valgt. Det gjelder hele borettslaget, ikke skjermen.
- `endreSkjerm` AVVISER felt malen ikke har og blokker orgen ikke eier — den rydder ikke
  stille. Klienten rydder selv ved malbytte (`ryddFelt`: felt som finnes i begge maler,
  beholdes). En ny skjerm får `standardFelt`. Slettes en blokk, tas den ut av alle skjermene.
- Mal og felt krever orgadmin, som resten av skjerminnstillingene.

En blokk uten data (tømmedager uten BIR, vær MET ikke har svart på) hoppes over i rotasjonen.
Skjermen henter bare data for blokker som står i et felt; forhåndsvisningen ber om alt
(`byggSkjerminnhold(…, { alt: true })`), så et felt styret har valgt, men ikke lagret, har noe
å vise.

**Migreringen** fra plassering per blokk (`board_placements`: område + skjermer, regnet om
til soner ved hver henting) er et idempotent TypeScript-steg ved oppstart, ikke SQL: den
bruker samme `fordelSoner` som regnet ut sonene før, så skjermene viser det samme etterpå.
Den rører bare skjermer der `zones` er `null`. Historikken står i `docs/beslutninger.md`
(29.09 og 30.09.2026).

### Én lagremodell

Skjerminnstillinger (navn, adresse, retning, skalering, mal, felt), farger og nettbrudd-valget
er ett utkast i `page.tsx`, lagret med den faste linja nederst («Ulagrede endringer»,
«Forkast», «Lagre»). Forhåndsvisningen tegner utkastet over serverdataene. Bytte av skjerm og
lenker ut av siden spør først (dialog i siden; `beforeunload` for lukking og omlasting —
nettleserens tilbakeknapp fanges ikke). Filopplasting og tredjepartskall lagres straks i sitt
eget vindu: logo, BIR-kobling, kontaktpersoner, vær og avganger.

### Innhold-fanen og rekkefølgen

Bare oppslag og kalender. Hele raden åpner redigering (sletting ligger i vinduet), utløpte
oppslag ligger bak «Vis N utløpte», og metalinjen viser visningstid og skjermer bare når de
avviker fra standard (`STANDARD_SEKUNDER`, alle skjermer). Rekkefølgen i rotasjonen er
`board_posts.sort_order` for hele borettslaget: radene dras (innebygd HTML-dra, virker ikke
på berøringsskjerm), et nytt oppslag havner øverst, og lista og skjermen sorterer likt
(`OPPSLAG_REKKEFOLGE`).

### Første gangs oppsett

Uten skjermer erstattes fanene av tre steg (`Forstegang` i `page.tsx`): koble til skjerm,
velg mal og innhold i feltene, legg ut første oppslag. Avgjøres når siden lastes, og varer
til første oppslag er lagt ut eller styret hopper over.

**Skalering** (`board_screens.scale`, 60–130 %, standard 85) ganges inn i `--u`, så tekst og
luft krymper sammen. Tavla måles i prosent av bredden — 4K og Full HD ser like ut; skalering
er for leseavstand og hvor mye som får plass.

### Kontaktpersoner

`board_contacts` peker på en **DriftIQ-bruker** i orgen (`user_id`) — ingen manuelle
kontakter. Navn, telefon og e-post leses ferskt fra profilen, rollen fra medlemskapets
tittel (endres under Brukere). Per person velger orgadmin om telefon og/eller e-post skal
vises (`show_phone`/`show_email`); det som er skjult, fjernes på serveren
(`kontakterForSkjerm`) og ligger aldri i svaret til skjermen. En som ikke lenger er medlem,
eller er deaktivert, faller ut av veggen av seg selv.

De roterer i rekkefølgen styret setter (`KONTAKT_SEKUNDER`). Uten kontaktpersoner viser
skjermen borettslagets egne felt (`organizations.phone`/`contactEmail`). Bildet er valgfritt
og lastes opp her (ikke fra profilen); skjermens bildebuffer har `bildeVersjon` i nøkkelen,
ellers ville et byttet bilde aldri blitt hentet på nytt.

### Det som er lett å gjøre feil

- **Forhåndsvisningen og skjermen deler både komponent og data** (`byggSkjerminnhold`). Lag
  aldri en egen «forhåndsvisnings-spørring» — da viser appen noe annet enn veggen.
- **Faste soner**: plassen avhenger av malen, aldri av innholdets lengde. Teksten i et
  oppslag skaleres så den fyller feltet (`finnTekstskala` i regelfila, målt av
  `useTilpassetTekst`): FØRST så det lengste ordet får plass i bredden, deretter ned til alt
  får plass i høyden, mellom 0,55 og 2,6. Første versjon målte bare høyden, og «arrangement»
  ble til «ement». Et ord som er for langt selv på minste størrelse, deles over to linjer
  (`overflow-wrap: anywhere`) — tekst klippes aldri vannrett. Tavla måles i `--u` (1 % av bredden × skalering), ikke `--fs-*` —
  unntaket gjelder bare innenfor `.ot-skjerm`.
- En skjerm som har lagret innhold fra FØR en endring i `Skjerminnhold`, viser det etter
  omstart uten nett. Nye felt må derfor tåle å mangle i klienten (`kontakter = []`,
  `skjerm.mal ?? standard`) — ellers er det en hvit skjerm i oppgangen til nettet er tilbake.
- **«Alle skjermer» er et flagg** (`all_screens`), ikke en liste — nye skjermer skal arve
  oppslag som gjelder hele borettslaget.
- **Skjermen har egen `localStorage`** (token + siste innhold, så den starter med oppslag
  etter strømbrudd uten nett). Appens regel om at bare org-valget ligger i localStorage
  gjelder kunde-appen, ikke denne enheten.
- Skjermen laster siden på nytt hver 12. time, ellers ville en TV kjørt gammel klientkode i
  månedsvis etter en deploy.
- Datoer er Oslo-datoer (`osloIDag`) — containeren kjører UTC.

## Etapper som gjenstår

Rekkefølgen er et forslag; hver etappe er leverbar alene.

**Etappe 2 — drift og tillit**
- Tilkoblingslogg per skjerm (opp/nede/varsel sendt) og e-postvarsel til styret når en skjerm
  har vært nede i N minutter, pluss «tilbake»-varsel. Egen bakgrunnsjobb (arver gatene i
  `instrumentation.ts`); skjermtid (av/på-tider) må trekkes fra, ellers varsler hver natt.
- Skjermtid: skjermen blanker seg selv utenfor på/av-tidene.

**Etappe 3 — mer innhold**
- PDF med lysbilder — BYGGET 30.09.2026 som del av «Bilder og PDF» over.
- «Arbeid i bygget» fra oppgaver/avvik. Krever et eget opt-in-flagg per oppgave — ikke alle
  oppgaver hører hjemme på en offentlig vegg.
- QR «Meld avvik» som åpner et offentlig avviksskjema med skjermens adresse forhåndsutfylt.
  Det offentlige skjemaet finnes ikke ennå og trenger egen vurdering (anonym skriving).
  Kontaktfeltet har derfor ingen QR-kode; det som så ut som en ødelagt en, var de stående
  rotasjonsprikkene (rettet 30.09.2026).
- Avfallshenting fra BIR — BYGGET 29.09.2026, se `docs/bir.md`.

**Etappe 4 — kalendersynk**
- iCal-lenke først (ingen OAuth, bare henting + parse), deretter Outlook/Google med OAuth.
  Bare hendelser med kategorien «Oppslagstavle». Egen integrasjonspakke etter mønsteret i
  `docs/easee.md`.

### BIR — tømmedager (bygget 29.09.2026, detaljer i `docs/bir.md`)

BIR har ikke noe dokumentert, offentlig API. Nettsiden bruker to flater som virker uten
innlogging:

1. **Søk (JSON):** `GET https://bir.no/api/search/AddressSearch?q=<tekst>&s=false` →
   `[{ Title, SubTitle, Id, RealEstateId, AgreementType, Url }]`. Treffer også SELSKAPER —
   «håsteinsgate 9» gir «Borettslaget Håsteinsgate 9», `Id` 180a56df-…, `RealEstateId`
   4601.153.217.0.2 (kommune.gnr.bnr.fnr.snr). Borettslag med fellesløsning har egen oppføring
   og må søkes opp som selskap; en adresse i laget kan gi et annet svar.
2. **Kalender (HTML):** `GET https://bir.no/adressesoek/toemmekalender/?rId=<Id>` gir tre
   måneder framover. Fraksjonen står bare som ikonfil i `.category-row .icon img`
   (`restavfall.svg`, `papirOgPlast.svg`, `matavfall.svg`, `glassOgMetall.svg`,
   `plastemballasje.svg`), datoene i `.date-item-date` («5. okt») under `.month-title`
   («Oktober 2026»). `/adressesoek/?rId=…` har bare neste dag per fraksjon.

Bygget som fjernbar pakke: styret velger BIR-oppføringen, jobben «bir-synk» henter hver
natt, skjermen leser bare tabellen. BIR er ikke spurt om tillatelse ennå.

**Åpne spørsmål (styret/eier)**
- Prising: per skjerm (lisens) eller fast modulpris? Mockupen sier «lisens nummer N,
  faktureres fra neste måned». Ingenting i `prismodell.ts` ennå.
- Skjermplattform: nettleserbasert (dagens løsning) dekker Samsung URL Launcher, Android-
  bokser og Raspberry Pi. En egen Tizen-/Android-app gir autostart og skjermtid via
  maskinvaren, men er en ny leveranse å vedlikeholde.
