# Unloc — digitale nøkler til leverandører

*Designnotat, 05.09.2026. Bygget fra Unloc API v2-dokumentasjonen (developer.unloc.app),
ikke fra v1: v1 hadde en Unloc-integrasjon, men koden forsvant med v1-repoet, og den var
bekreftet ubrukt 09.08.2026. Dette er et nytt forsøk, bygget for å kunne fjernes igjen.*

## Hva det gjør

Styret deler ut en digital nøkkel til en person hos en leverandør — «Ola hos Heis AS får
Hovedinngang til fredag» — fra fanen **Digitale nøkler** på leverandørkortet. Mottakeren
får nøkkelen i Unloc-appen på mobilnummeret sitt. DriftIQ bokfører utdelingen: hvem i
styret ga den, til hvem, hvilken lås, gyldighet, hvorfor — og hvem som kalte den tilbake.
Utdeling og tilbakekalling går i hendelsesloggen.

Koblingen (kundens API-credentials hos Unloc) settes opp én gang av kontoadmin under
**Innstillinger → Integrasjoner**.

## Hvorfor det er bygget som én fjernbar pakke

Det er usikkert om integrasjonen er gjennomførbar for kundene: Unloc-credentials utstedes
per *organisasjon* hos Unloc, og for et borettslag som får låsene sine via boligbyggelaget
(«Vestbonøkkelen» er Vestbos Unloc-oppsett) er det ikke gitt at laget selv kan få dem.
Derfor skal alt kunne tas ut igjen uten spor i resten av appen. Grensene:

| Del | Fil(er) |
|---|---|
| Skjema | `src/db/schema/unloc.ts` (+ én linje i `index.ts`), `drizzle/0054_unloc.sql` |
| RLS | to tabellnavn i `DIREKTE_TABELLER` i `src/db/rls/tables.ts` |
| HTTP-adapter | `src/lib/unloc.ts` (importfri — brukes også av klienten for telefonformat) |
| Logikk | `src/lib/unlockobling.ts` |
| Ruter | `src/app/api/organizations/[orgId]/unloc/**`, `…/vendors/[vendorId]/unloc-keys/**` |
| Klient | `unloc`-blokken nederst i `src/lib/klient.ts` |
| UI | `src/app/(app)/innstillinger/UnlocKort.tsx`, `src/components/UnlocNokler.tsx`, `.un-`-blokken i `globals.css` |
| Tester | `tests/unloc.test.ts` |
| Koblinger inn i resten | `antallAktiveNokler()` i `slettLeverandor` (én import); `<UnlocKort />` i Integrasjoner; én fane + én import i `LeverandorDetaljModal.tsx`; `unloc_settings`/`vendor_unloc_keys` i `EKSKLUDERTE_TABELLER` i `lib/eksport.ts` (sto der fra før) |

Ingen egen modul, ingen env-variabel, ingen bakgrunnsjobb, ingen webhooks. Rutene gates
med `modul: "leverandorer"`; hemmeligheten krypteres med samme nøkkel som Fiken-tokens
(`FIKEN_TOKEN_KEY` via `lib/kryptering.ts` — navnet er historisk, nøkkelen er felles for
integrasjonshemmeligheter).

### Slik fjernes den

1. Ny migrasjon som dropper `vendor_unloc_keys` og `unloc_settings`.
2. Slett filene i tabellen over; fjern de to tabellnavnene fra `rls/tables.ts`, linja i
   `schema/index.ts`, `unloc`-blokken i `klient.ts`, `.un-`-blokken i `globals.css`.
3. Fjern importen og sjekken i `slettLeverandor`, `<UnlocKort />` i Integrasjoner, og
   fanen «nokler» + importen i `LeverandorDetaljModal.tsx`.
4. `tests/rls.test.ts` er grønn igjen når tabellene er borte fra både base og register.

## Unloc-modellen, kort

- **Organisasjon** → **prosjekter** → **låser** og **nøkler**. Credentials (`client_id` +
  `client_secret`) byttes i et JWT med `project.admin`-scope per prosjekt
  (`POST /v2/auth/token/`), gyldig en time. `POST /v2/auth/resources-discovery/` sier
  hvilke prosjekter credentials når — det er slik koblingen velger prosjekt (automatisk
  ved ett, ellers ber feilmeldingen om `projectId` og navngir kandidatene).
- En **nøkkel** er (lås, mobilnummer i E.164, start, slutt/ingen). Mottakeren trenger ikke
  finnes i Unloc på forhånd; Unloc sender invitasjon. Tilstander: `creating`, `scheduled`,
  `active`, `inactive` (utenfor ukedag/tidsrom), `expired`, `revoked`, `error`.
- **Opprettelse er asynkron**: `POST /v2/projects/{id}/keys` svarer 202 med en jobb.
  `opprettNokkel` poller jobben i inntil ~10 s; blir den ikke ferdig, finnes nøkkelen ved
  søk på (lås, nummer) og raden får `state` fra Unloc — «creating» hvis den fortsatt er
  underveis. Fanen frisker opp ved neste åpning.
- **Tilbakekalling** er `DELETE /v2/projects/{id}/keys/{keyId}`. 404 tolkes som «allerede
  borte der» og raden oppdateres likevel.
- Nøkler som forsvinner fra Unloc (kalt tilbake i Control Center) speiles som `revoked`
  med `revoked_by = «Unloc (utenfor DriftIQ)»` ved neste oppfrisking.

## Hvitelista

`TILLATTE_KALL` i `lib/unloc.ts` er de eneste kallene som slipper ut: token,
ressursoppdagelse, lese prosjekt, lese låser, lese nøkler, lese jobbstatus, opprette nøkkel,
kalle tilbake én nøkkel. Ikke bulk-tilbakekalling, ikke låser, låsforbindelser,
adgangsgrupper, dørklokker eller administrerte brukere. `tests/unloc.test.ts` låser lista.
Løftet til kunden: DriftIQ rører aldri annet i Unloc enn nøklene den selv har delt ut.

## Tilgang

| Handling | Nivå |
|---|---|
| Se status/kobling, se nøkler | `lesing` (modulen leverandører) |
| Dele ut / kalle tilbake, lese låser | `redigering` — samme som fysiske nøkler og adgangskort |
| Koble til / fra | `admin` — credentials gir tilgang til kundens låser |

Frakobling lar nøkkelradene stå (historikk) og logger hvor mange som fortsatt var aktive
i Unloc. Sletting av en leverandør nektes mens den har levende nøkler.

## Lært mot ekte Unloc (05.09.2026, prosjektet «DriftIQ test» med virtuelle låser)

- `start: null` / `end: null` avvises med 400 «must be of type string», selv om
  dokumentasjonen sier null er lov. Feltene UTELATES i stedet (= nå / uten utløp).
- Utløpte nøkler kan ikke kalles tilbake: `DELETE` svarer 409 «May not revoke expired
  keys». Behandles som 404 — raden oppdateres uansett.
- Feilformatet er problem-JSON med `detail` og `invalidParams[{name, reason}]`; begge
  havner i meldingen til brukeren.
- v1 la `metadata.driftiq_vendor`/`driftiq_vendor_id` på nøklene (synlig i Control Center);
  v2 gjør det samme og legger til `driftiq_issued_by`.
- **502/504 fra API-et når aldri klienten**: Cloudflare-tunnelen erstatter dem med sin egen
  HTML-side, og klienten viser «Noe gikk galt». Unloc-feil er derfor 400 (avvist) eller 503.

Hele stien utdeling → `active` → tilbakekalling → `revoked` er kjørt mot det ekte
prosjektet via `delUtNokkel`/`tilbakekall` (05.09.2026). `nokkelIdFra()` prøver `id`,
`keyId` og `key.id` i jobbresultatet; treffer ingen, faller koden til søk på lås + nummer.

## Kandidater senere, hvis den blir stående

- Automatisk utløp ved oppgavens/avtalens slutt; nøkkel rett fra en oppgave.
- Nattlig oppfrisking av tilstand (jobb i `instrumentation.ts`) i stedet for ved åpning.
- Adgangshendelser via webhook («døra ble åpnet 09:12 av Ola») i driftsloggen.
