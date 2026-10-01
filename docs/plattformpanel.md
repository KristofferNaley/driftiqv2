# Plattformpanelet

Bruksnotat for plattformadmin: hva sidene i panelet (`admin.driftiq.no`, test:
`test-admin.driftiq.no`) gjør, hva avkrysningene faktisk styrer, og hvordan support-innsyn
virker. Skrevet 01.10.2026 etter at en support-sesjon mot «DEMO - Sammen Sameie» ga en tom
kundeapp uten feilmelding — se «Feilsøking».

Koden: sidene i `src/app/(plattform)/plattform/`, rutene i `src/app/api/plattform/`,
logikken i `src/lib/plattform.ts` og `src/lib/kundedetalj.ts`, gatene i `src/lib/tilgang.ts`.

## Grunnregelen: panelet er kundeforhold, ikke kundedata

Panelet viser navn, moduler, abonnement, antall brukere og *antall* oppgaver/avvik — aldri
innholdet. Hver rute går gjennom `plattformRute({ nivaa: "plattformadmin" })` og kjører i
`withoutRls("plattformpanel")`.

For å se eller endre kundens data (oppgaver, avvik, beboere, dokumenter) må du starte en
**support-sesjon** og bruke kundeappen (`app.driftiq.no`). Uten den svarer alle
orggatene i `tilgang.ts` 403 — også om du har et medlemskap i orgen. Rollen sjekkes før
medlemskapet.

## Menyen

Seks punkter: **I dag** og **Innmeldinger** øverst, **Salg og kunder** (Leads, Kunder),
**Innsikt** (Statistikk) og **Innstillinger** nederst ved «Til kundeappen» og lys/mørk.
Tellerne kommer fra `/api/plattform/tellere`.

| Side | Hva den er til |
|---|---|
| I dag | Arbeidsliste. «Krever handling» samler punkter fra hele plattformen (disk over 85 %, jobb som feilet siste kjøring, innmelding ubesvart mer enn én arbeidsdag, besvart sak som har stått stille i 14 dager, kunde uten e-post (ikke demo), aktiv support-økt), hver med knapp dit det løses. Reglene og grensene står i `src/lib/idag.ts`. Under kortet: nye leads, innmeldinger og support-økter siden forrige innlogging (nest siste `innlogget` i `auth_events`; eldre enn 90 dager vises som «siste 90 dager»). Plattformtallene som sto her, er øverst på Statistikk. |
| Statistikk | Forretning og produktbruk: nøkkeltall, kundehelse, ukesaktivitet, modulbruk. Demo-kunder kan slås av og på i nøkkeltallene; grafene holder dem alltid utenfor. Inaktive kunder regnes ikke som «ekte». |
| Leads | Salgsløpet ny → kontaktet → kvalifisert → kunde. Her opprettes nye kunder (se «Ny kunde»). |
| Innmeldinger | Innmeldinger fra «Meld feil» i appen (feil, forslag, spørsmål), med tråd mot melderen og interne notater. «Løst» sender e-post til melderen. Telleren i menyen er saker der kunden venter på svar: ikke løst og ingen melding til kunden ennå, samme regel som «Ubesvart» på siden. Stien er fortsatt `/plattform/saker`. |
| Kunder | Kundelista og kundesiden — se under. |

### Innstillinger

Én side med undermeny til venstre (`/plattform/innstillinger/<side>`). De gamle stiene
(`/plattform/prismodell`, `/boligbyggelag`, `/maler`, `/brukere`, `/support`, `/system`)
omdirigerer hit, så bokmerker virker.

| Underside | Hva den er til |
|---|---|
| Prismodell | Standardprisene nye avtaler regnes fra (gulvpris, trinn per andel, modulpriser). Hver lagring blir en versjon. Kundens faktiske avtale redigeres på kundesiden, ikke her. |
| Boligbyggelag | Registeret over boligbyggelag. Globalt; brukes til tilknytning og forretningsfører på kundesiden. Flere kunder kan peke på samme lag, og lag kan slås sammen. Kundetallet teller unike kunder med laget som tilknytning ELLER forretningsfører; testbasen har ingen slike koblinger og viser 0 overalt. |
| HMS-maler | Spørsmålslistene for vernerunde og risikovurdering. Felles for alle kunder; kunden velger mal, men kan ikke endre punktene. Endringer slår ikke tilbake på gjennomførte runder. |
| Varsler | Hvem som får e-post om nye leads og innmeldinger (`pricing_config.leads_notify_emails`). Tom liste faller tilbake på `LEADS_NOTIFY_EMAIL`. |
| Plattformadmins | **DriftIQs egne plattformadmins**, ikke kundenes brukere. Kundebrukere administreres inne i kundeappen. `kontoansvarlig` fra v1 tilbys ikke; rollen er ikke implementert i tilgangslaget. |
| Innsynslogg | Support-økter på tvers av alle kunder: hvem har innsyn nå, og hvem har hatt det. Økter startes fra kundesiden. |
| System | Systemhelse, viktigst om RLS faktisk er i kraft (spurt mot databasen), pluss disk og bakgrunnsjobber. |

## Kundesiden (Kunder → <kunde>)

`src/app/(plattform)/plattform/kunder/[orgId]/` (én fil per fane). Tre faner (BL-180).
Valgt fane står i `?fane=oversikt|abonnement|tilgang`. De gamle undersidenøklene
(`sammendrag`, `organisasjon`, `onboarding`, `brukere`, `support`, `innsyn`) sendes videre
til riktig fane.

Øverst: kundehodet med navn, chips (Aktiv/Inaktiv, Demo, selskapsform, «Kunde siden …»,
andeler) og to handlinger, **Rediger** (åpner Organisasjon-skjemaet) og **Support-modus**
(dialog, se «Support-sesjon»). Mens et innsyn pågår, står en stripe over hodet med navn,
utløpstid, begrunnelse og «Avslutt».

### Oversikt

- **Krever handling** øverst, skjult når det ikke finnes punkter. Antallet står i gult på
  fanen. Regelsettet er én ren funksjon, `kreverHandling()` i `lib/kundehandlinger.ts`
  (ny regel = én oppføring i `REGLER`):
  - *Mangler e-post* (rødt): e-postfelt med Lagre, formatet sjekkes også på serveren.
  - *Mangler org.nr* (gult): 9 siffer + «Slå opp». Setter org.nr og fyller *tomme* felt
    (kommune, e-post, telefon, nettside) fra Enhetsregisteret. Nektes hvis en annen
    kunde har nummeret.
  - *Mangler selskapsform* (gult).
  - *Onboarding: <sjekk>* (gult), ett per sjekk som ikke er oppfylt. Abonnement går til
    fanen, andeler til Rediger. Resten sender en påminnelse på e-post til kundens aktive
    orgadmins (styret: «Inviter styremedlem»). Påminnelsen logges i kundens
    hendelseslogg og nektes når punktet er oppfylt eller kunden ikke har noen orgadmin.
- **Nøkkeltall**: fire klikkbare kort. Abonnement (pris per år, rabatt), Moduler (antall
  og hvilke som er av), Onboarding (prosent og hva som mangler) og Sist aktiv (kundens
  siste innlogging, uten plattformbrukere).
- **Organisasjon** — ett kort med én «Rediger», i fire seksjoner: Identitet (navn, org.nr,
  selskapsform, kommune), Størrelse (andeler, enheter i Enhetsregisteret, har ansatte),
  Kontakt (e-post, telefon, nettside) og Tilknytning (boligbyggelag, forretningsfører).
  Skjemaet har i tillegg lagringskvote i GB og avkrysningene **Aktiv kunde** og **Demo-
  eller testkunde** (se «Aktiv vs. demo»). Tilknytningen lagres i samme transaksjon.
  Tomme verdier vises som «Ikke satt».
  **Selskapsform** er en nedtrekksliste med Brreg-kodene (Borettslag, Eierseksjonssameie,
  Tingsrettslig sameie, Boligaksjeselskap), ingen fritekst. Den settes også av «Slå opp»
  på org.nr. Kunder fra før BL-180 som ikke kunne kobles, listes av
  `scripts/selskapsform-rapport.ts`.
- **Aktivitet** — innlogginger per uke de siste 12 ukene (søyler, fra `auth_events`),
  siste innlogging og antall oppgaver, avvik og kontrakter. Bare antall. Plattformbrukere
  teller ikke; en bruker i to kunder teller hos begge.
- **Onboarding** — sjekkliste regnet ut fra *antall* rader hos kunden (abonnement,
  andeler, Enhetsregisteret, «Om bygget», styret med minst to brukere, leverandører,
  kontrakter, …). Plattformadmins medlemskap teller ikke som kundens brukere.
- **Slett kunde** nederst, se «Slette en kunde».

### Abonnement

- **Moduler og pris** — brytere per modul, gruppert som i kundens sidemeny. «Lagre
  modulvalg» skriver `organizations.enabled_modules`. Dashboard og Brukere er alltid på.
  Moduler uten pris står som «Inkludert». Under lista: listepris for valget, rabatt og hva
  kunden betaler etter avtalen (frosne priser). Kunden har
  ingen egen bryter — modulvalget styres bare herfra.
- **Abonnement** (samme fane) — den registrerte avtalen: grunnpakke (snapshot fra sist
  lagring), tilleggsmoduler med pris, rabatt, start-/sluttdato, notat. Varsler når
  grunnpakken med dagens prismodell avviker fra snapshotet.
  - **Ingen avtale sperrer ingenting.** Avtalen er bokføring.
  - **En utløpt sluttdato sperrer kunden** (`abonnementUtlopt`): har orgen avtaler og alle
    har passert sluttdatoen, avvises kundens brukere med «Abonnementet er utløpt …».
    Plattformadmin med support-sesjon slipper forbi, for innsyn og sletting.
  - 100 % rabatt vises som «Pilot» i kundelista.

### Tilgang

- **Brukere** — tabell med navn, rolle og sist innlogget. Plattformadmins
  supportmedlemskap er merket «Plattformadmin». Kun visning; her finnes
  ingen knapp for å legge til eller endre brukere (se «Ny kunde»).
- **Innsynslogg** — de 20 siste support-sesjonene mot kunden: hvem, begrunnelse, start og
  slutt («pågår»).

## Aktiv vs. demo

To uavhengige avkrysninger i «Rediger organisasjon». De står rett etter hverandre, men
styrer helt forskjellige ting:

| | **Aktiv kunde** (`organizations.active`) | **Demo- eller testkunde** (`organizations.demo`) |
|---|---|---|
| Kundeappen | Av ⇒ orgen **filtreres bort** fra `/api/meg` og vises aldri i orgvelgeren — for alle, også plattformadmin i support. Ingen feilmelding. | Ingen effekt. |
| Innlogging | Av ⇒ brukere der *alle* medlemskapene er inaktive, avvises med «Organisasjonen er deaktivert» (`sjekkInnloggingssperrer`). Plattformadmin hoppes over. | Ingen effekt. |
| Varsler | Av ⇒ varselsjobben hopper over orgen. | Ingen effekt. |
| Statistikk/prismodell | Av ⇒ ikke «ekte» kunde; utenfor priskurven og konsekvenstabellen. Status «Inaktiv» i kundelista. | På ⇒ holdes utenfor statistikk og forretningstall. |

Merk: API-gatene i `tilgang.ts` sjekker *ikke* `active` — skjulingen skjer i `/api/meg`
og ved innlogging. Det er derfor appen blir tom i stedet for å vise en 403.

**Demo-orgene skal være Aktiv = på og Demo = på.** «Demo» er nok til å holde dem utenfor
tallene; å slå av «Aktiv» gjør dem ubrukelige.

## Support-sesjon

1. Kunder → <kunde> → **Support-modus** øverst til høyre (fra hvilken som helst fane).
2. Skriv en begrunnelse i dialogen (minst 3 tegn — «Kunden ringte om …») og trykk **Start
   support-modus**. Det lager en rad i `support_access_log` med navnet ditt kopiert inn.
3. Åpne kundeappen og velg orgen i orgvelgeren. En stripe øverst («Support-modus. Du ser … på
   et logget innsyn») og «Support-modus» under navnet ditt i sidemenyen viser at innsynet
   er aktivt. Stripa lenker tilbake til kundesiden i panelet.
4. Avslutt med **Avslutt** i stripen over kundehodet. Du kan bare avslutte dine egne
   sesjoner — ikke en kollegas. Mens innsynet pågår, er knappen i hodet «Til kundeappen».

Regler:

- **Maks 4 timer** (`SUPPORT_SESJON_MAKS_TIMER` i `tilgang.ts`). Deretter utløper sesjonen
  av seg selv, og du må starte en ny med ny begrunnelse. Det er ingen forlengelse.
- Hver start er en ny rad, også om du allerede har en aktiv — to ærend er to innsyn.
- Uten aktiv sesjon har plattformadmin **ingen** tilgang til kundens data: `krevOrgTilgang`,
  `krevOrgRedigering` og `krevOrgAdmin` sjekker rollen først og krever sesjon uansett
  medlemskap. Med sesjon har du full orgadmin-tilgang, også når kundens abonnement er utløpt.
- **Orgen må ligge i orgvelgeren din.** Orgvelgeren viser bare orger du har et *medlemskap*
  i (`user_org_memberships`) og som er aktive. Sesjonen alene gir ikke orgen en plass i
  velgeren. De migrerte kundene har plattformadmin-medlemskap fra v1 («supportinnganger»).
- Innsynet logges og vises i panelet: «Innsynslogg» under fanen Tilgang per kunde og Innstillinger ›
  Innsynslogg på tvers. Loggen er laget for at kunden skal kunne se den, men per
  01.10.2026 finnes det ingen side i kundeappen som viser den.

## Ny kunde

Nye kunder opprettes **bare fra Leads**. Det finnes ingen «Ny kunde»-knapp i kundelista.

1. Leads → legg inn lead (eller bruk en innkommet), flytt den til **kvalifisert**.
2. **Opprett kunde** (vises bare på kvalifiserte leads). `konverterLead` lager orgen med navn,
   org.nr, selskapsform, kommune og kontaktinfo fra et ferskt Brreg-oppslag. Leadens
   kontaktperson kopieres ikke inn. Avvises hvis org.nr allerede finnes som kunde.
3. Du havner på den nye kundesiden. Orgen er **aktiv**, ikke demo, og har ingen egen
   modulliste (standardsettet, se `PA_SOM_STANDARD` i `lib/moduler.ts`).
4. Fyll inn antall andeler under Oversikt → Organisasjon, velg moduler under Abonnement, og
   registrer abonnementet.

### Kjent mangel: første bruker

Det finnes **ingen vei i UI-et for å legge til første bruker i en ny kunde.**

- Brukere opprettes bare av `inviterBruker` via `POST /api/organizations/<orgId>/users`,
  altså Brukere-siden i *kundeappen*, og den krever orgadmin.
- Plattformadmin kan kalle den med support-sesjon, men en ny org har ingen medlemmer,
  heller ikke plattformadmin. Da dukker den aldri opp i orgvelgeren, og Brukere-siden kan
  ikke nås.
- Fanen «Brukere» på kundesiden i panelet er bare visning.

Inntil det er bygget, må første orgadmin legges inn direkte i databasen. Ellers må et
plattformadmin-medlemskap opprettes slik at orgen kan åpnes i kundeappen under support.

## Slette en kunde

Kunder → <kunde> → **Oversikt** → kortet «Slett kunde» nederst. Tenkt for kunder som
har prøvd systemet uten å kjøpe, og for sletting etter oppsigelse. Koden er i
`lib/kundesletting.ts`.

1. Sett kunden **inaktiv** først («Rediger» → fjern krysset i «Aktiv kunde»). Før det er
   knappen død.
2. **Slett kunde …** → skriv kundens navn nøyaktig → **Slett kunden**.

Det som slettes: organisasjonen og alt den eier (oppgaver, avvik, dokumenter, økonomi,
oppslagstavle, integrasjonskoblinger, abonnement, innsynslogg, hendelseslogg, feilmeldinger),
filene under `uploads/orgs/<orgId>/`, og brukerkontoer som *bare* var med i denne kunden.
Kontoer med medlemskap i andre kunder og plattformadmins beholdes. En lead kunden kom fra
beholder statusen «Kunde», mister lenken og får linja «Kunden slettet» i loggen.

Sperrer:

- Aktive digitale nøkler hos Unloc må trekkes tilbake i kundeappen først (krever
  support-sesjon). Slettingen fjerner bare radene våre, ikke nøklene hos Unloc.
- Ingen angre. Den nattlige sikkerhetskopien (14 dager) er eneste vei tilbake, og den
  gjenoppretter hele basen, ikke én kunde.
- Slettingen logges bare i serverloggen (`[kundesletting] …`), siden kundens egen
  hendelseslogg forsvinner med kunden.

## Feilsøking

### Kundeappen er tom under support

Symptom: sesjonen er startet, men orgen finnes ikke i orgvelgeren, eller appen laster
ingenting. Ingen feilmelding.

Sjekk i rekkefølge:

1. **Er orgen aktiv?** Kunder → <kunde> → chipen i hodet. Står det «Inaktiv»: «Rediger»
   → kryss av **Aktiv kunde** → lagre. Det var årsaken 01.10.2026. Avkrysningen
   står ved siden av «Demo», og de er lette å forveksle.
2. **Er sesjonen fortsatt gyldig?** Stripen «Support-modus aktiv» skal stå på kundesiden. Etter 4
   timer utløper den stille; start en ny. Uten gyldig sesjon finnes orgen i velgeren, men
   alle kall gir 403 («Plattformadmin må aktivere support-modus …»).
3. **Har du medlemskap i orgen?** Se «Orgen må ligge i orgvelgeren din» over. Gjelder
   typisk nye kunder fra Leads.
4. **Last kundeappen på nytt.** `/api/meg` hentes ved sidelast og når fanen får fokus
   (høyst hvert minutt). Stripa og orglista følger ikke en sesjon du nettopp startet før
   den hentes på nytt.

### Kunden får ikke logget inn

- «Organisasjonen er deaktivert» → Aktiv kunde er av for alle orgene brukeren er med i.
- «Abonnementet er utløpt …» → alle avtalene har passert sluttdatoen. Fjern eller forleng
  sluttdatoen under «Moduler og pris».

### En modul mangler i kundens meny

Modulvalget styres bare fra «Moduler og pris». Kundeappen henter det på nytt ved fokus,
så kunden kan måtte bytte fane eller laste siden på nytt.
