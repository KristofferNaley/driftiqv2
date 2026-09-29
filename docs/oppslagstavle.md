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
| Tabeller | `src/db/schema/oppslagstavle.ts` — `board_screens`, `board_posts`, `board_events`, `board_settings`, `board_contacts`, `board_blocks` (DIREKTE), `board_pairings` (UNNTATT) |
| Logikk | `src/lib/oppslagstavle.ts` |
| Regler, typer, palett (importfri) | `src/lib/oppslagstavleregler.ts` |
| Maler og soner (importfri) | `src/lib/tavlemaler.ts` |
| Vær- og avgangsblokker | `src/lib/tavleblokker.ts` — se `docs/entur-yr.md` |
| Styrets API | `/api/organizations/{orgId}/oppslagstavle/…` via `orgRute` |
| Skjermens API (anonymt) | `/api/skjerm/kobling`, `/kobling/status`, `/innhold`, `/fil/{postId}`, `/logo` |
| Adminside | `src/app/(app)/oppslagstavle/page.tsx` |
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
`filForSkjerm` gir bare bilder fra oppslag skjermen selv skal vise. Fjernes skjermen i appen,
svarer neste henting 401 og skjermen går tilbake til koblingsbildet.

### Oppslag, visningstid og typer

Hvert oppslag har egen visningstid (`display_seconds`, fast liste i `VISNINGSTIDER`), og
skjermen bruker en timeout per oppslag, ikke et fast intervall. Oppslag kan redigeres (tekst,
periode, skjermer, tid); typen og bildet står fast — et nytt bilde er et nytt oppslag.
Typene viktig/informasjon/arrangement styrer BARE merkelapp og kantfarge
(`KATEGORI_BESKRIVELSE` forklarer dem i skjemaet), ikke rekkefølge eller tid.

### Maler og plassering

HVA som vises og HVOR, velges på **innholdet**; skjermen velger bare **mal**.

- **Blokker** er enten innebygde (`oppslag`, `kalender`, `kontakt`, `tommedager` — faste
  nøkler, ingen rad) eller egne med innstillinger i `board_blocks` (vær og avganger, nøkkel
  `blokk:<id>`, `docs/entur-yr.md`).
- **Plassering** (`board_placements`, én rad per blokknøkkel): område — Hovedfelt, Sidefelt,
  Stripe nederst eller Ikke vist — og skjermer (alle eller et utvalg). Mangler raden, gjelder
  `STANDARD_PLASSERING` (oppslag i hovedfeltet, kalender og kontakt i sidefeltet, tømmedager i
  stripen; egne blokker i sidefeltet). Settes med «Vises: … [Endre]» øverst i hvert kort under
  Innhold, og i skjemaet for vær/avganger.
- **Mal** (`MALER` i `lib/tavlemaler.ts`, 5–6 per retning): ett stort felt `a`, null til tre
  små (`b`–`d`) og stripen. `board_screens.layout`.
- **Sonene regnes ut** (`fordelSoner`) — de lagres ikke: hovedfelt → `a`; sidefelt → ett per
  lite felt i rekkefølge (`SIDE_REKKEFOLGE`), og det som ikke får plass roterer i det siste;
  fullskjerm-maler tar sidefeltene inn i rotasjonen i `a`; stripe → stripen, kompakt og side
  om side. Blir et lite felt stående tomt, er malen for stor for innholdet.

En blokk uten data (tømmedager uten BIR, vær MET ikke har svart på) hoppes over i rotasjonen.
Skjermen henter bare data for blokker som faktisk havner i en sone.

Sone-for-sone-valg per skjerm (A/B/C/D) ble prøvd samme dag og forkastet — for omstendelig;
se `docs/beslutninger.md`.

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
- **Faste soner**: plassen avhenger av malen, aldri av innholdets lengde. Lange oppslag
  klippes (`line-clamp`). Tavla måles i `--u` (1 % av bredden × skalering), ikke `--fs-*` —
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
- Redigere et oppslag (i dag: bare opprette/slette).

**Etappe 3 — mer innhold**
- PDF-presentasjon: rastrer sidene med `pdftoppm` (finnes i imaget, se tekstuttrekk) til
  bilder ved opplasting, maks 20 sider, bla eller bare første side.
- «Arbeid i bygget» fra oppgaver/avvik. Krever et eget opt-in-flagg per oppgave — ikke alle
  oppgaver hører hjemme på en offentlig vegg.
- QR «Meld avvik» som åpner et offentlig avviksskjema med skjermens adresse forhåndsutfylt.
  Det offentlige skjemaet finnes ikke ennå og trenger egen vurdering (anonym skriving).
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
