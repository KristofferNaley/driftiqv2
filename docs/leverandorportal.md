# Leverandørportal — designnotat

*Utkast 26.08.2026. Idéstadiet — ingenting her er bygget, men `"leverandorportal"` ligger
allerede reservert som `RlsUnntak` i `src/db/client.ts`, og dette notatet beskriver hva
unntaket er tiltenkt.*

## Idéen

Leverandører som jobber fast for flere borettslag (vaktmester, heisfirma, elektriker) får
egen innlogging på tvers av kundene sine: én samlet oppgaveliste, kvittere ut på stedet,
melde avvik, laste opp dokumentasjon — uten QR-kode og uten å logge inn i ett system per
borettslag.

Validering fra virkeligheten: en heismontør kalte uoppfordret DriftIQ «et av de bedre
internkontrollsystemene» han hadde sett — og fortalte at de i dag logger inn i flere
ulike systemer for å registrere det samme. Leverandørene har altså samme
fragmenteringssmerte som borettslagene.

## Hvorfor dette er strategisk, ikke bare en feature

Portalen snur salgsdynamikken. En leverandør som allerede bruker DriftIQ hos fem
borettslag har egeninteresse av at det sjette også velger det — leverandøren blir
distribusjonskanal. Leverandørsiden kan derfor gjerne være gratis: de er ikke kunden, de
driver verdi og churn-motstand på betalersiden. Tosidige nettverkseffekter av denne typen
er vanskelige å kopiere i etterkant.

Portalen henger sammen med partnerregisteret (se «Kobling» under) og er det naturlige
steg to etter et «Bruker DriftIQ»-merke på leverandørkortet.

**Nettverkseffekten er lokal.** Et heisfirma i Bergen hjelper ingen i Trondheim — men i
Bergen er det gull. Strategien er derfor tetthet i én by før bredde: ti borettslag og fem
kjente bergensleverandører er et sterkere nettverk enn femti kunder spredt utover landet.
For et styre er «kjente lokale leverandører bruker systemet» sosialt bevis fra aktører de
allerede stoler på — et bedre salgsargument enn noen funksjonsliste. Naturlig første
partner: heisfirmaet som allerede har gitt uoppfordret positiv tilbakemelding, som pilot
mot å være referanse.

## To personaer definerer designet

**Vaktmesteren — bredde.** Mange små oppgaver, gjerne hele kategorier, på tvers av flere
lag. Trenger én «min dag»-liste, kvitterer ut og melder avvik med eget navn. Mobilbruk,
ofte dårlig dekning (kjeller, garasjeanlegg).

**Heisfirmaet — dybde.** Montøren sjekker fysisk ut oppgaven når hen er på stedet;
kontoret laster opp servicerapporten i etterkant. Dette tvinger frem det viktigste
designvalget: **leverandøren er en organisasjon med flere brukere i ulike roller**, ikke
én innlogging.

Minst to roller fra dag én:

| Rolle | Gjør | Kontekst |
|---|---|---|
| `utfoerer` | Kvitterer ut, melder avvik, tar bilder | Mobil, på stedet, dårlig dekning |
| `kontor` | Laster opp dokumentasjon, ser historikk | Desktop, i etterkant |

`vendorContacts` (flere kontaktpersoner per leverandør, med roller) er frøet til dette.

## Datamodell — skisse

- **Leverandørkonto på plattformnivå** (UNNTATT fra RLS, som `bbl`): identifisert ved
  orgnr, med egne brukere (Better Auth — vurder eget auth-skjema eller et
  `accountType`-felt). Én konto per leverandørfirma, uansett hvor mange borettslag de
  jobber for.
- **Tilgangskobling per org**: `vendor_portal_grants` e.l. — borettslagets kobling mellom
  sin `vendors`-rad og leverandørkontoen, med omfang (hvilke moduler/kategorier). Org-eid
  tabell med vanlig RLS.
- **Tildeling**: leverandøren ser kun oppgaver/rutiner eksplisitt tildelt sin
  leverandør-rad i den orgen. Aldri orgens øvrige data.

Matching mot partnerregisteret skjer ved lesing på normalisert orgnr — ingen kobling
lagres før borettslaget aktivt gir tilgang.

## Tilgangsregler — de harde kravene

1. **Tilgang gis av borettslaget, tas ikke av leverandøren.** Styret aktiverer «gi
   Heisservice AS portaltilgang til våre heisoppgaver». Opt-in begge veier — samme
   filosofi som `aiReadable` på dokumenter.
2. **Tenantisolasjonen snus på hodet.** «Min dag»-lista krysser orger per definisjon og
   bryter `withOrg`-invarianten — det er dette `withoutRls("leverandorportal")` er
   reservert for. Unntaket er bare halve jobben: hver spørring MÅ filtrere eksplisitt på
   leverandørkonto + aktiv grant, og det må ha krysstester etter mønster fra
   `tests/ai.test.ts` («leverandør A ser aldri org B uten grant»). En leverandør som ser
   naboborettslagets avvik er en tillitskatastrofe.
3. **Egen vert** (`portal.driftiq.no`): samme vertsdelingsmønster som panelet —
   vertsbundne cookies, og borettslagsruter finnes ikke på den verten.
4. **Aktør og protokoll**: portalbrukere kvitterer med ekte identitet
   (`Aktor { navn, brukerId }`) — et bedre revisjonsspor enn QR-flytens anonyme
   `brukerId: null`. Handlinger logges i orgens `audit_events` som i dag, med leverandøren
   som aktør.
5. **Filer**: servicerapporten tilhører borettslaget (det er deres internkontroll).
   Opplasting går mot orgens lagring, kvote og eierskap — leverandøren er avsender, ikke
   eier.
6. **QR-flyten beholdes** for engangsleverandører uten konto. Begge flyter ender i samme
   oppgave- og protokolldata, bare med ulik aktøridentitet.

## Byggerekkefølge

1. **Vaktmester-caset**: én bruker per leverandør, samlet oppgaveliste, kvittere ut og
   melde avvik. Minst ny flate, størst daglig verdi — og beviser isolasjonsmodellen.
2. **Dokumentopplasting** for firmaer (heisfirma-caset, fortsatt én rolle).
3. **Kontorrollen**: flere brukere per leverandørkonto med rolleskille utfører/kontor.

## Åpne spørsmål

- Auth: eget Better Auth-oppsett for portalen, eller samme med kontotype-felt? (Egen vert
  gir uansett egen cookie; spørsmålet er datamodellen.)
- Skal vaktmesteren kunne se rutinebeskrivelser/sjekklister, eller kun tildelte oppgaver?
- Varsling: e-post til leverandøren ved ny tildeling? (Gjenbruk `epost.ts`-rammen.)
- ~~Prising~~ **Avklart 26.08.2026**: å registrere dokumentasjon for et borettslag koster
  leverandøren ingenting — det er borettslagets internkontroll, og borettslaget betaler
  for den. Døren holdes åpen for at leverandøren senere kan betale for *sine egne*
  verktøy (flere brukere, egen historikk på tvers av kunder, rapporter), men grunnflyten
  i verdikjeden er kundens kostnad.
- Offline-toleranse for utfører-rollen (PWA-en finnes; hvor langt skal den strekkes?).
