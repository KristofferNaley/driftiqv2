# Tekstsøk i dokumenter — uttrekk og OCR

*Designnotat, 06.09.2026. Bygget samme dag; det som står her er slik det ble.*

## Hva det gjør

Søkeboksen (det globale søket, `lib/sok.ts`) treffer på **innholdet** i filene i
dokumentarkivet, ikke bare tittel, beskrivelse og filnavn. Treffet viser et utdrag rundt
ordet («… ble funnet en «vannlekkasje» bak dusjen …»), så styret ser hvorfor dokumentet
dukket opp. På dokumentet står det en rad «Søkbar tekst»: Ja / Ja (OCR) / Nei med grunn /
Venter.

## Hvordan

**Teksten bor på raden.** `documents.content_text` fylles av `lib/tekstuttrekk.ts`, ikke
av en egen indekstabell — samme begrunnelse som i sok.ts: en kopi på raden kan ikke drifte
fra dokumentet. Kolonnen sendes aldri til klienten (`DOK_UTVALG` i `lib/dokumenter.ts`
velger kolonner; `harTekst` er det klienten får). Teksten kappes ved 400 000 tegn, fordi
en tsvector ikke kan være over 1 MB.

**Tre lag, billigst først:**

| Lag | Verktøy | Når |
|---|---|---|
| Tekstlag | `unpdf` (pdf.js) for PDF, `mammoth` for .docx | Alltid først. Dekker de fleste — i FDV-eksempelet (docs/fdv.md) 261 av 303 PDF-er |
| OCR lokalt | `tesseract` (norsk språkdata; engelsk brukes i tillegg hvis installert) + `pdftoppm`, i kjørebildet (Dockerfile, ~70 MB) | PDF med under 40 tegn per side (skannet), og bilder (JPEG/PNG/WebP/GIF). Inntil 60 sider per PDF |
| Ikke mulig | — | .doc, HEIC, eller OCR-verktøy som mangler. Raden får `text_error` med grunnen |

Ingenting sendes ut av serveren. Claude leser dokumenter kun via AI-rådgiveren, og kun
med `aiReadable` — tekstsøket rører ikke den linja. (Claude som OCR for `aiReadable`-
dokumenter er en mulig påbygning, ikke bygget.)

**Når:** rett etter opplasting (`etterCommit` i dokumentruta, egen transaksjon) og av
bakgrunnsjobben «tekstuttrekk» hvert 5. minutt (`instrumentation.ts`), som tar de eldste
uforsøkte først, 25 per runde, hver i sin egen `withOrg`. Jobben logger til `job_runs` bare
når det fantes noe å gjøre, og starter ikke en ny runde oppå en som fortsatt kjører.

**Ett forsøk per dokument.** Både suksess og feil setter `text_extracted_at`; ellers ville en
ødelagt fil blitt forsøkt hvert femte minutt for alltid. `nullstillTekst()` åpner for et
nytt forsøk (ingen UI for det ennå — kandidat: knapp på dokumentet når `text_error` er satt).

## Søket

`KILDER[dokumentarkiv]` i sok.ts fikk tre ting: `content_text` i FTS-uttrykket, en egen
ILIKE-gren på `coalesce(content_text,'')` (sammensatte ord — «lekkasje» treffer
«vannlekkasje» kun via trigram), og et utdrag som er `ts_headline` ved FTS-treff og en
tekstbit rundt første forekomst ved delords-treff. Indeksene står i
`drizzle/0055_dokumenttekst.sql`, som erstattet 0047-indeksen for `documents`. **Uttrykkene
må speile hverandre** — avviker de, blir det stille seq scan (samme regel som 0047).

## Grenser og fjerning

Alt ligger i `lib/tekstuttrekk.ts`, fire kolonner på `documents`, jobben, `etterCommit`-
kallet i dokumentruta, raden på dokumentsiden og `apk add`-linja i Dockerfile. Kontrakt-
filene (`contracts.fileName`) har samme behov og kan få samme kolonner senere.

## Lært underveis

- **Alpine har ingen fonter.** Uten `fontconfig` + `font-liberation` tegnet `pdftoppm`
  PDF-er med ikke-innbakte skrifter som blanke sider («Couldn't find a font for
  'Helvetica'»), og OCR-en fant ingenting. Skannede PDF-er er bilder og rammes ikke, men
  testene gjorde det — og en PDF laget av et gammelt program uten innbakte fonter ville også.
- **pdf.js dropper tekst utenfor siden.** En håndlaget test-PDF med én lang linje mistet
  slutten; ikke et problem for ekte dokumenter, men testene brekker linjer.
- **`tesseract-ocr-data-nor` er den eneste språkpakken i imaget.** `-l nor+eng` feiler når
  `eng` mangler, derfor velges språkene fra `--list-langs` ved oppstart.

## Verifisert

`tests/tekstuttrekk.test.ts`: håndskrevne PDF-er (med og uten tekstlag), ekte OCR i
containeren, ett-forsøk-regelen, at teksten aldri når klienten, søk med utdrag og
tenantisolasjon.
