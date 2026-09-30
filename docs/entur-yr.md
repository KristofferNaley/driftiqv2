# Entur og yr — avganger og vær på oppslagstavla

*Bygget 29.09.2026. Begge er åpne API-er uten nøkkel. Oppslagstavla generelt:
`docs/oppslagstavle.md`.*

## Hva det gjør

Vær og avganger er **innholdsblokker**: styret lager dem fra feltvelgeren under «Skjermer og
oppsett» (nivå redigering), gir dem et navn, og orgadmin velger dem inn i et felt per skjerm. En org kan ha flere —
for eksempel én avgangsblokk per oppgang med hver sin holdeplass.

- **Vær** (`vaer`): et sted (adressesøk via Kartverket, som gir koordinater) og visning
  «de neste timene» (12 timer, vist annenhver) eller «de neste dagene» (5 dager fra i morgen,
  maks/min, symbol midt på dagen, nedbør). Stripen viser nå + tre steg.
- **Avganger** (`avganger`): én eller to holdeplasser (Enturs holdeplassøk), inntil seks
  avganger per holdeplass de neste to timene. Sanntid vises i aksentfarge; innstilte er
  strøket over. Tiden vises som på skiltet: «nå», «4 min», ellers klokkeslett.

Konfigurasjonen ligger som JSON i `board_blocks.config`, validert med Zod (`blokkInn` i
`lib/tavleblokker.ts`) både ved skriving og lesing — en ødelagt rad blir en blokk uten
innstillinger, ikke en krasj på veggen.

## Flatene (hvitelistene)

| Tjeneste | Kall | Fil |
|---|---|---|
| Entur geocoder | `GET api.entur.io/geocoder/v1/autocomplete?text=…&layers=venue` | `lib/entur.ts` |
| Entur Journey Planner v3 | `POST api.entur.io/journey-planner/v3/graphql` (`stopPlace.estimatedCalls`) | `lib/entur.ts` |
| MET Locationforecast 2.0 | `GET api.met.no/weatherapi/locationforecast/2.0/compact?lat&lon` | `lib/yr.ts` |
| Kartverket adresser | `GET ws.geonorge.no/adresser/v1/sok?…&utkoordsys=4258` | `sokSted` i `lib/kartverket.ts` |

Nettleseren kaller aldri noen av dem — søkene går gjennom `/oppslagstavle/blokker/sok/*`.

## Vilkårene, og hvordan koden følger dem

- **Entur** krever `ET-Client-Name` (vi sender `driftiq-oppslagstavle`). Uten den kan de
  strupe oss uten å vite hvem de skal kontakte. Data er NLOD.
- **MET** krever identifiserende `User-Agent` med nettsted (ellers 403), at svaret gjenbrukes
  til `Expires` og at vi deretter spør med `If-Modified-Since` (304 = uendret), og høyst fire
  desimaler i koordinatene (`rundAv` ved lagring). Lisensen er CC BY 4.0 — «Værdata fra MET
  Norway» står under værblokken på skjermen, og skal stå der.

## Mellomlagrene (i minnet)

Skjermene henter innhold hvert minutt. Uten mellomlager ville ti skjermer gitt ti kall per
minutt til hver tjeneste.

| | Fersk | Ved feil |
|---|---|---|
| Avganger (per holdeplass) | 30 sekunder | forrige svar i inntil 30 min, ellers tom liste |
| Vær (per koordinat) | til `Expires` | forrige svar i inntil 6 timer, ellers `varsel: null` (blokken skjules) |

Ingenting kastes ut til skjermen: en tredjepart som feiler gir en blokk som viser forrige
svar eller forsvinner fra sonen, aldri en tavle som ikke svarer. Minnet deles mellom alle
orger — det er offentlige rutedata og værdata, ikke kundedata. Det overlever ikke en
omstart, og det forutsetter én instans (samme forutsetning som bakgrunnsjobbene).

Dataene hentes bare for blokker som faktisk står i en sone på skjermen (`blokkdataForSkjerm`
får nøklene i bruk), og aldri av tilgangssjekken for bilder (`medEksterne = false`).

## Ikoner

Værsymbolene er lucide-ikoner (`vaersymbol()` i `lib/vaerregler.ts`), ikke METs egne
ikoner — de ville vært ~80 SVG-filer å hente, lisensiere og vedlikeholde. `SYMBOLER` er en
ordnet liste: første treff vinner, så «sleet» står før «rain» og «thunder» først. Natt gir
måne der det finnes en månevariant.

## Fjernbar pakke

| Del | Fil(er) |
|---|---|
| Tabell | `board_blocks` (i `src/db/schema/oppslagstavle.ts`), `drizzle/0063_oppslagstavle_maler.sql` |
| HTTP + tolkning + mellomlager | `src/lib/entur.ts`, `src/lib/yr.ts`, `sokSted` i `src/lib/kartverket.ts` |
| Regler (importfri) | `src/lib/vaerregler.ts` |
| Logikk | `src/lib/tavleblokker.ts` |
| Ruter | `src/app/api/organizations/[orgId]/oppslagstavle/blokker/**` |
| Klient | `tavleblokker`-blokken nederst i `src/lib/klient.ts` |
| UI | `src/app/(app)/oppslagstavle/Blokker.tsx`, `Vaer`/`Avganger` i `Tavleskjerm.tsx`, `.ot-vaer*`/`.ot-avgang*`/`.ot-linje` i `globals.css` |
| Tester | `tests/tavleblokker.test.ts`, `tests/fixtures/met-locationforecast.json` |

Fjernes vær eller avganger: slett blokktypen fra `BLOKKTYPER`/`blokkInn`, rendereren og
filene over. Rader av en ukjent type blir blokker uten innstillinger; en migrasjon bør slette
dem. `slettBlokk` tar nøkkelen ut av feltene; en nøkkel uten blokk hoppes uansett over på skjermen.
