# Mobilapp — designnotat

*Utkast 20.09.2026. Idéstadiet — ingenting her er bygget. Notatet henger sammen med
`docs/leverandorportal.md` (appen er den naturlige flaten for utfører-rollen der) og
`docs/modultilgang.md` (appens funksjonsutvalg er et forvalg av samme begrep).*

## Idéen

En enkel app — iOS i første omgang — for det som skjer *på stedet*: melde avvik, se egne
oppgaver og kvittere dem ut. Styremedlemmer utfører også oppgaver selv, så dette er ikke
bare en leverandørflate. Alt som er skrivebordsarbeid (kontrakter, parkering, økonomi,
innstillinger) blir værende på web.

Appen skal gi det PWA-en ikke gir: pålitelige push-varsler, en ordentlig kameraflyt,
Face ID, en kø som tåler kjeller og garasjeanlegg uten dekning — og tilstedeværelse i
App Store.

## Teknologivalg

**Expo / React Native, ikke Swift og ikke webview-innpakning.**

- «iOS i første omgang» betyr Android senere; da skal koden være felles.
- TypeScript: appen kan importere Zod-skjemaene og de **importfrie** filene direkte
  (`oppgaveregler.ts`, `nivaer.ts`, `avvikkategorier.ts`, `aktor.ts`, `varselvalg.ts`).
  Regelen om importfrie filer ble laget for klientbundlet, men gir dette gratis:
  `erForsinket` finnes fortsatt ett sted. Ikke lag kopi nummer to.
- EAS bygger i skyen — verken Mac eller Node på VPS-en kreves.
- Å pakke dagens PWA i Capacitor/webview risikerer avvisning hos Apple (4.2 «minimum
  functionality») og gir ingen av gevinstene over.

Appen legges i samme repo (`mobil/`, med i `.dockerignore`) så delte filer importeres,
ikke kopieres.

## Harde krav — det som er lett å gjøre feil

### 1. API-et blir en kontrakt som lever lenge

I dag deployes `klient.ts` og rutene sammen; en endring i et svar og i forbrukeren går i
samme commit. En app i App Store lever i måneder på gamle versjoner. Dette er den
viktigste nye disiplinen appen innfører.

- **Egen, liten, versjonert flate: `/api/mobil/v1/…`** — bygget med samme `orgRute` og de
  samme lib-funksjonene. Rutene er 3–6 linjer, så kostnaden er lav, og webappen kan
  refaktoreres fritt uten å knekke appen.
- Flaten er samtidig den **eksplisitte hvitelista** over hva som er «i appen».
- Endringer i v1 er kun additive. Bruddendringer = `v2` ved siden av.
- Appen sender versjonen sin i en header; serveren kan svare «Oppdater appen» (egen
  status og `detail`) når en versjon ikke lenger støttes.
- Feilformatet er som ellers `{ "detail": "<norsk melding>" }`, og aldri 502/504.

### 2. Å skjule moduler i appen er UI, ikke sikkerhet

Sesjonen appen holder virker mot hele API-et. Det er greit — brukeren har de rettighetene
uansett — men appens menyvalg er ingen gate. Skal en bruker faktisk *ikke* ha tilgang til
kontrakter, er det `docs/modultilgang.md` som løser det, ikke appen.

### 3. Auth

- Better Auths Expo-plugin: sesjonstokenet lagres i Keychain. **Ikke** gjenbruk
  JWT-pluginen — 15-minutters bærer uten tilbakekalling, og den er allerede kandidat for
  fjerning.
- Appens scheme (`driftiq://`) må inn i `BETTER_AUTH_TRUSTED_ORIGINS`. Samme 403-felle
  som sist, og like usynlig for bygg, lint og tester.
- 7 dager glidende sesjon er for kort for en app. Lengre sesjon for app-klienten +
  lokal Face ID-lås + «innloggede enheter» med utlogging per enhet.
- `hentBruker` slår opp brukeren ferskt per forespørsel — en deaktivering biter
  umiddelbart også i appen. Ikke cache nivå/moduler utover det `/api/meg` nettopp svarte.
- Tofaktor (TOTP) må virke i appens innloggingsflyt.
- `auth_events` bør få klienttype (web/app), så «hvor er jeg innlogget» kan vises.

### 4. Push

- Enhetstabell på **brukernivå** (`UNNTATT` i RLS-registeret, med skriftlig grunn), ny
  kanal i `varselvalg.ts`, sending i `etterCommit` via samme varselsløype som e-post.
- **Mottakere utledes ved sending fra medlemskapene** — ikke fra en abonnementsliste.
  Fjernes noen fra styret, stopper varslene av seg selv.
- Med modultilgang: en bruker uten tilgang til en modul får heller ikke push fra den.
- Nøytral tekst på låseskjermen — ingen detaljer om avviket.
- Tokens for deaktiverte brukere og avinstallerte apper ryddes (APNs svarer 410).

### 5. Offline og dobbeltinnsending

Kø for **nøyaktig to handlinger** — kvittere ut og melde avvik. Ikke generell synk.

- Klientgenerert idempotensnøkkel per handling; ellers gir et retry i garasjen to avvik.
- Lagre både klientens *utført*-tidspunkt og serverens *mottatt*-tidspunkt. Protokollen
  skal leses likt om ti år, og da må det gå fram at kvitteringen ble sendt i ettertid.
- «Allerede kvittert av en annen» er et normalt utfall, ikke en feil — vis hvem og når.
- Bufrede data på enheten har kort levetid; serveren er fasit ved hver synk.

### 6. Bilder

HEIC/HEIF er allerede tillatt i `TILLATTE_TYPER`, men grensen er 15 MB og kvoten 5 GB.
Appen skaler ned og komprimerer til JPEG før opplasting. Opplastingen går gjennom
`lagring.ts` som alt annet (type → størrelse → kvote → disk).

### 7. Cloudflare

En bot-challenge svarer HTML; en native klient finner ingen `detail` — samme symptom som
502-fella (Unloc, 05.09.2026). API-stien appen bruker trenger WAF-unntak, og det må
verifiseres mot den ekte tunnelen, ikke localhost.

### 8. QR-kodene kan åpne appen

Med universal links åpner `/kvittering/[token]` og `/rutine/[token]` appen når den er
installert — og kvitteringen får ekte `Aktor { navn, brukerId }` i stedet for QR-flytens
anonyme `brukerId: null`. Krever `/.well-known/apple-app-site-association`, som må inn i
`alltidTillatt` i `src/middleware.ts`. Den anonyme flyten består uendret for alle uten app.

### 9. Apple

- App Review krever en **demokonto i prod**. Demo-orgene finnes i dag bare i testbasen.
- Beboere vil laste ned appen og ikke komme inn (`disableSignUp: true`).
  Innloggingsskjermen må si at kontoen opprettes av styret.
- Plan for kontosletting må finnes (5.1.1).
- Abonnementet selges utenfor appen; appen verken selger eller lenker til kjøp (3.1.1).
- **Organisasjonskonto hos Apple krever juridisk enhet med D-U-N-S-nummer.**
  Privatregistrering viser personnavn som selger. Så lenge DriftIQ AS ikke finnes, ligger
  selskapsetableringen på kritisk sti for lansering — ikke for utvikling og TestFlight.

### 10. Miljøer

Byggvarianter mot `test.driftiq.no` og `app.driftiq.no`, med eget ikon og navn for test
(samme tanke som «TEST IQ»-manifestet). TestFlight-bygg går mot test.

## Styret og leverandører i samme app

Svarer på det åpne auth-spørsmålet i `docs/leverandorportal.md`:

**Én app, én innlogging, samme `users`-tabell — og hva du er, utledes av koblingene dine,
ikke av et `accountType`-felt.**

- Medlemskap i en org ⇒ styremodus (nivå og modultilgang som på web).
- Medlemskap i en leverandørkonto ⇒ portalmodus («Min dag» på tvers av kunder, rollene
  `utfoerer`/`kontor`).
- `/api/meg` returnerer begge. Har du bare én type, ser du aldri en velger; har du begge,
  får du en kontekstvelger der orgbytteren står i dag.

Hvorfor ikke `accountType`: elektrikeren som også sitter i styret i eget sameie finnes, og
Better Auth har én bruker per e-postadresse. Med kontotype måtte hen hatt to adresser.

Sikkerheten ligger på serveren, ikke i appens modus:

- Portalen får egen wrapper `portalRute` på egen flate (`/api/portal/…`, etter mønster av
  `plattformRute`). En leverandørbruker har ingen medlemskap, så hver `orgRute` **feiler
  lukket** uten at noe må huskes.
- `withoutRls("leverandorportal")` brukes **kun til kryss-org-lesingen** (lista).
  Kvittering og avviksmelding: verifiser grant → `withOrg(oppgavens org)`. Skrivestien
  beholder RLS, og `KryssendeOrgKontekst` beskytter fortsatt.
- Krysstester etter mønster av `tests/ai.test.ts`: «leverandør A ser aldri org B uten
  grant».
- Enhetens hurtiglager inneholder flere kunders data — en trukket grant må tømme det.

**Styreappen er ikke en omvei til portalen.** Oppgaveliste + kvittering + avviksmelding for
styret er ~80 % av vaktmester-caset; «Min dag» er samme liste med org-etikett per rad.
Modelleres «kontekst» (org *eller* leverandørkonto) som begrep i appen fra dag én, blir
portalen en ny konteksttype, ikke en ny app. Utfører-rollen kan være app-først;
kontor-rollen hører hjemme på web (`portal.driftiq.no`).

## Byggerekkefølge

1. **`/api/mobil/v1` + et mobiltilpasset «felt»-skjermbilde i dagens PWA.** Validerer
   omfanget og kontrakten før Apple-arbeidet, og har verdi alene.
2. **Expo-appen for styret**: innlogging, oppgaver, kvittering, avvik med bilde, push,
   kø. TestFlight mot `test.driftiq.no`.
3. **Universal links** for QR-kodene.
4. **Portalen som ny kontekst** (følger byggerekkefølgen i portalnotatet).

## Åpne spørsmål

- Skal en bruker kunne *melde* avvik uten å *se* andres? I dag er «melde» knyttet til
  `lesing`. Se «Den tredje handlingen» i `docs/modultilgang.md`.
- Beboere: utenfor omfang nå, men appen i App Store vil skape forventningen. Er QR-flyten
  svaret, eller kommer en beboerflate?
- Hvor lenge støttes en gammel appversjon før «Oppdater appen»?
- Sjekklister/rutiner offline — kun visning, eller utfylling i kø også?
- Android: samtidig med iOS når Expo uansett gir det, eller bevisst etter?
