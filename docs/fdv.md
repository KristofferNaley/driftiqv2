# FDV-dokumentasjon — hva den er, hva den er verdt, og hva DriftIQ bør gjøre med den

*Notat 05.09.2026, etter gjennomgang av FDV-leveransen fra ombyggingen av ni leiligheter i
Håsteinsgate 9 (2024, hovedentreprenør Byggmester Hitland, byggherre Vestbo). Grunnlaget er
Kristoffers ryddede kopi (Cowork), som allerede er langt ryddigere enn det styret fikk.
Ingenting her er bygget; notatet skal styre hva vi bygger.*

## Hva en FDV-leveranse faktisk er

| | |
|---|---|
| Omfang | 303 PDF-er på 1 708 sider, 70 bilder, 16 e-poster, 2 regneark — 168 MB |
| Kilder | 14 e-poster fra 11 leverandører, sept. 2024 – jan. 2025, samlet av entreprenøren |
| Datablad | **165 PDF-er (54 %)**: grossistblad for elektromateriell (130 stk), sprinklerrør, bend, ekspansjonsbolter, klammer |
| «FDV-dokumenter» | 42 PDF-er, 990 sider — men rørleggerens «FDV per leilighet» er samme 56-siders perm ni ganger |
| Uten tekstlag | 42 PDF-er er bilder (sluttkontroll, samsvarserklæring, tegninger) |
| Levert på lenke | Rørlegger via filemail (utløpt), elektro via eldoc.no, NorDan via docs.nordan.no |

Tre eksempler som viser mønsteret:

- **Rørlegger, 56 sider per leilighet.** To sider er ekte vedlikeholdsinstruks (vannlås
  renses to ganger i året, lekkasjestopper resettes slik, hovedstoppekran står i bod). De
  resterende 54 er monteringsanvisninger og produktblad for TECE-koblinger og lekkasjestopper.
- **Kjøkken, 18 sider.** Designas generelle brosjyre. Prosjektsiden med leilighetsnummer og
  saksbehandler er **ikke fylt ut**. Dokumentet er identisk for alle ni leiligheter.
- **Vinduer, 1 side.** NorDan leverer ett ark med ordrenummer og lenke til docs.nordan.no.
  Dokumentasjonen bor hos produsenten, ikke i leveransen.

Det som faktisk er spesifikt for bygget er lite og verdifullt: kursfortegnelser per tavle,
plantegninger for elektro og sprinkler, systemskjema, premissnotat, sluttkontroller med
måleverdier og signatur, samsvarserklæringer, og **elleve bilder per bad av skjult varmekabel
før flisene kom på** — det eneste som sier hvor man ikke kan bore.

Og det som *mangler* er det som betyr mest: sprinklerens sjekklister ble lovet 15.01.2025 og
kom aldri; ferdigattest, som-bygget-tegninger, branntegninger og overtakelsesprotokoller
finnes ikke i leveransen; ventilasjonens serviceavtale er en tom mal.

## Fire slags innhold — bare ett av dem lager arbeid

FDV er ikke én ting. Innholdet faller i fire kategorier med helt ulik verdi og bruk:

1. **Bevis.** Samsvarserklæring, sluttkontroll, risikovurdering, premissnotat, ferdigattest.
   Leses aldri i drift; hentes fram ved salg, forsikringssak, tilsyn eller tvist. Verdien er
   at det *finnes* og kan finnes igjen på under et minutt. Lite volum.
2. **Kart.** Kursfortegnelser, plantegninger, systemskjema, bilder av skjulte føringer. Trengs
   når noe ryker eller noen skal bore. Høy verdi, lite volum, men må ligge på riktig anlegg
   eller riktig leilighet for å være til nytte.
3. **Regime.** Intervallene: vannlås to ganger i året, ventilasjonsfilter to ganger i året,
   sprinklerventil kvartalsvis, brannalarm årlig, lekkasjestopper testes. **Dette er den eneste
   delen av FDV som skaper oppgaver** — og den ligger gjemt som to sider inni 56-siders permer.
4. **Støy.** Produktblad for bend og bolter, generiske brosjyrer, duplikater. 60–70 % av sidene.

Det er kategori 3 som er internkontroll. Kategori 1 og 2 er arkiv. Kategori 4 skal ikke inn i
noe som helst, bare beholdes som rådata i én zip.

## Hvorfor styrer «kjører seg i hodet»

Fordi verktøyene, og forskriften, snakker om FDV som et dokumentproblem: «oppbevar
dokumentasjonen». Da blir oppgaven å sortere 300 filer i mapper, og det gjør ingen. Realiteten
er at FDV er et **utvinningsproblem**: finn de 20 dokumentene som er bevis og kart, trekk ut de
5–10 intervallene som er regime, og legg resten i en pose.

Kristoffers Cowork-runde er nettopp den utvinningen, gjort for hånd med god hjelp. Den tok
en kveld for ett prosjekt, og resultatet — «LES MEG»-fila med struktur, avvik og
kontrollpunkter — er mer verdt for styret enn hele leveransen. Det er *den* jobben DriftIQ
skal gjøre, ikke tilby 300 opplastingsfelt.

## Hva DriftIQ bør gjøre

### 1. FDV-boksene på anlegget holder, men de skal holde lite

De fem slottene (bruksanvisning, samsvarserklæring, tegninger, vedlikeholdsinstruks, garanti)
stemmer godt med kategori 1 og 2. Det som må inn i tillegg:

- **Peker til leverandørens dokumentsenter** som eget felt på anlegget: eldoc-lenke med
  ordrenummer for elektro, docs.nordan.no med ordrenummer for vinduer. Kilden bor hos
  leverandøren; vi eier pekeren. Det er slik leveransene faktisk kommer i 2024.
- **Bilder som egen slott** («skjulte føringer»). Elleve bilder av varmekabel er ikke en
  «tegning», og de er det mest verdifulle i hele leiligheten.
- **Nedlasting** av det som er lastet opp. Finnes ikke i API-et i dag.

### 2. Regimet skal ut av dokumentene og inn i rutiner

«Lag rutine fra dette dokumentet»: fra anleggets FDV-instruks opprettes rutiner med
intervall, knyttet til anlegget, så de havner i oppgaver og årshjul. Manuelt først (styret
leser de to sidene og fyller inn), deretter med AI-rådgiveren som leser PDF-en og foreslår
intervallene. Rørleggerens to sider blir tre rutiner; ventilasjonens mal blir én; sprinklerens
manglende sjekklister blir et avvik mot leverandøren.

### 3. Leveransen er en enhet, og mangellisten er styrets egentlige jobb

Innfør **leveranse** (prosjekt) som samlende begrep: «Ombygging 2024 — Hitland», med
entreprenør, leverandører og kontaktpersoner, hva som er mottatt, og **hva som mangler** målt
mot en fast liste (ferdigattest, som-bygget-tegninger ARK, branntegninger,
overtakelsesprotokoll, sjekklister for sprinkler, serviceavtale ventilasjon). Det er
«Avvik og ting som må avklares» i LES MEG-fila, satt i system. Rådataen — hele zip-en —
ligger på leveransen i dokumentarkivet, urørt, som bevis på hva som kom.

### 4. Leilighetene får en tynn pakke, ikke permen

Enhetsarbeid per leilighet (finnes) med **den** dokumentasjonen som er spesifikk:
kursfortegnelse, sluttkontroll, plantegning, bilder av varmekabel, rørleggerens to sider,
kjøkkenets ordrelinje. Alt annet i leveransen er felles for de ni og lenkes én gang. Ved
salg overleveres pakken; det er det borettslaget skylder andelseieren.

### 5. Innlastingen er produktet

En «FDV-innlasting» som tar zip-en, går gjennom filene og foreslår: bevis, kart, regime eller
støy — hvilket anlegg eller hvilken leilighet — hvilken slott — hvilke intervaller. Styret
godkjenner forslagene, ikke sorterer filene. AI-rådgiveren gjør klassifiseringen; den har
allerede dokumentlesing bak `aiReadable`. Dette er den ene funksjonen som gjør at et sameie
uten forretningsfører kan ta imot en FDV-leveranse uten å kjøre seg fast.

## Rekkefølge

1. Pekerfelt og bildeslott på anlegget, nedlasting av FDV-dokumenter (små endringer).
2. «Lag rutine fra FDV», manuelt.
3. Leveranse med mangelliste.
4. AI-klassifisering av opplasting.

## Åpne spørsmål

- Skal andelseieren få pakken sin gjennom DriftIQ (lenke uten innlogging, samme mekanisme som
  avvik-til-leverandør-idéen), eller som PDF ved salg?
- Hvor mye av kategori 4 skal AI-rådgiveren kunne lese? Den kan svare på «hvilken
  lekkasjestopper har vi?» fra et produktblad, men indekseringen koster.
- Mangellisten mot TEK17/entreprenørens FDV-mal: fast liste i koden, eller per leveranse?
