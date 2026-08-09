# MCP-servere

`.mcp.json` i repo-roten setter opp to MCP-servere for Claude Code. Fila er prosjekt-scopet,
så den gjelder alle som åpner dette repoet — ikke bare denne maskinen.

## Hvorfor de kjører i Docker

**Det er ikke installert Node på verten.** Alt utviklingsarbeid i dette prosjektet går
gjennom `docker run node:22-alpine` eller `docker compose`. En vanlig MCP-oppsett med
`"command": "npx"` ville derfor bare feilet med «command not found».

Begge serverne kjøres i stedet som `docker run --rm -i node:22-alpine npx …`, med repoet
montert på `/app`. Volumet `driftiq-mcp-npm` holder npm-cachen mellom kjøringer — uten det
lastes pakken ned på nytt hver gang en økt starter. Opprett det med:

```bash
docker volume create driftiq-mcp-npm
```

Versjonene er pinnet. En MCP-server som stille bytter versjon under beina på deg er verre
enn en som er et halvt år gammel.

**Merk at stien til repoet står absolutt i `.mcp.json`.** Docker-montering godtar ikke
relative stier, og MCP-serveren startes ikke nødvendigvis fra repo-roten. Flyttes repoet, må
stien rettes.

## `nextjs` — next-devtools-mcp 0.4.0

Vercels egen. Fire verktøy, og det er verdt å vite hva de faktisk gjør:

| Verktøy | Nytte her |
|---|---|
| `nextjs_docs` | Returnerer **stien** til `node_modules/next/dist/docs/` — 444 markdown-filer som følger nøyaktig den Next.js-versjonen som er installert. Fetcher ingenting. |
| `nextjs_index` | Finner kjørende **dev-servere** og henter runtime-feil, ruter og komponenttre. |
| `nextjs_call` | Kaller et verktøy på en av dev-serverne over. |
| `browser_eval` | Peker på `agent-browser`-CLI-et. Gjør ingen automatisering selv. |

To forbehold, så ingen bruker tid på å lure:

- **`nextjs_index` finner ingenting slik dette prosjektet kjøres.** Appen bygges og kjøres som
  produksjonsbygg i Docker (`docker compose up -d --build`), ikke med `next dev`. Kjører du
  `next dev` lokalt, blir verktøyet nyttig — ellers ikke.
- **`nextjs_docs` gir deg en sti du kunne funnet selv.** Dokumentasjonen ligger allerede i
  `node_modules/next/dist/docs/` og kan leses direkte med vanlige filverktøy. Verdien er at
  den *minner om* at versjonsriktige dokumenter finnes lokalt, i stedet for at man svarer
  fra hukommelsen eller googler en annen versjon.

## `better-auth` — @better-auth/mcp 1.4.17

Ett verktøy: `setup_auth`, som genererer oppsett for et prosjekt som ikke har Better Auth
ennå.

**Dette prosjektet har allerede Better Auth 1.6.26 ferdig satt opp** — vertsbundne
cookies, `trustedOrigins`, `twoFactor`-plugin, passordtilbakestilling. Serveren er altså
tatt med for fullstendighetens skyld, ikke fordi den løser et problem vi har i dag.

Vær dessuten oppmerksom på at **serveren er pinnet til 1.4.17 mens appen kjører 1.6.26**.
Det er den nyeste versjonen med et kjørbart binary (1.7.0-rc.4 har ingen `bin`). Genererer
den et oppsett, kan det være mot et eldre API enn det vi faktisk bruker — sjekk mot
`src/lib/auth.ts` før du tror på det.

## Sjekke at de virker

Håndkjør en `tools/list` mot serveren:

```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"p","version":"1"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | docker run --rm -i -v driftiq-mcp-npm:/root/.npm -v /home/kristoffer/stacks/driftiqv2:/app -w /app node:22-alpine npx -y next-devtools-mcp@0.4.0

```
