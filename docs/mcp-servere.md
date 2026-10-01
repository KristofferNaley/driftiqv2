# MCP-servere

`.mcp.json` i repo-roten setter opp MCP-servere for Claude Code: seks eksterne
servere som bare er URL-er — `context7` (se under) og fem Cloudflare-servere (`mcp.cloudflare.com` +
docs/bindings/builds/observability — remote-servere uten lokal kjøring, autentisert mot
Cloudflare-kontoen ved bruk). Fila er prosjekt-scopet, så den gjelder alle som åpner dette
repoet — ikke bare denne maskinen.

## Lokale servere er fjernet (01.10.2026)

`nextjs` (next-devtools-mcp) og `better-auth` (@better-auth/mcp) kjørte som
`docker run --rm -i node:22-alpine npx …` og er tatt ut:

- `nextjs_index`/`nextjs_call` finner bare `next dev`-servere, og appen kjører som
  produksjonsbygg. `nextjs_docs` ga bare stien til `node_modules/next/dist/docs/`, som kan
  leses direkte.
- `better-auth` har ett verktøy, `setup_auth`, for prosjekter uten Better Auth. Her er det
  allerede satt opp (og serveren var pinnet eldre enn appen).
- **Containerne ble stående.** `docker run -i` rydder ikke etter seg når Claude Code
  avsluttes uten ren nedstenging — `--rm` virker først når prosessen stopper. Ti stykker
  hadde samlet seg over dager. Ryddes med
  `docker ps -q --filter ancestor=node:22-alpine | xargs -r docker stop` (sjekk først at
  ingen pågående økt trenger dem).

Skal en lokal server legges til igjen: Node er ikke installert på verten, så den må kjøres
via Docker med absolutt repo-sti i `.mcp.json`, og stoppes ved økt-slutt.

## `context7` — mcp.context7.com

Versjonsriktig biblioteksdokumentasjon på forespørsel. Lagt til for **Drizzle og Better
Auth**: Next-dokumentasjonen ligger allerede lokalt i `node_modules/next/dist/docs/`, men
de to andre har ingen tilsvarende — og uten oppslagsverk svares det fra hukommelsen, som
kan være en major-versjon bak.

Remote-server, ingen lokal kjøring. Gratisnivået er ratebegrenset; en API-nøkkel fra
context7.com hever grensene, men er ikke lagt inn — trengs den, hører den hjemme i
personlig konfigurasjon, ikke i denne prosjekt-scopede fila.

## Vurdert og ikke lagt til

- **Playwright MCP** — ville dekket det reelle hullet (UI-verifisering; to ganger har et
  klikk gjennom appen funnet feil alle andre lag slapp gjennom), men en agent skriver ikke
  passord i innloggingsfelt, og v2 har ingen sesjonsmynting for testbrukeren slik v1 hadde
  JWT-mynting. Uten den er verdien begrenset til utloggede flater. Tas opp igjen hvis det
  bygges et dev-skript som lager en sesjon for `claude@driftiq.test`.
- **Postgres MCP** — `docker exec postgres psql` gir det samme, med samme forbehold
  (superbruker omgår RLS).
- **Resend MCP** — `scripts/test-epost.ts` dekker behovet, og et sendeverktøy utenom
  domenevakten er mer risiko enn nytte.
- **GitHub MCP** — `gh`-CLI-en dekker alt; arbeidsflyten er push-til-main uten PR-er.
