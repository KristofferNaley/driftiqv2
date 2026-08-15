# DriftIQ — slik bygges det

Alt i dette designsystemet er **norsk**: komponentnavn (`Kort`, `Skuff`, `Tekstfelt`), props
(`tittel`, `verdi`, `onEndre`, `etikett`) og all synlig tekst. Skriv norsk UI-tekst.
Produktet er driftsstyring for borettslag og sameier — oppgaver, avvik, leverandører,
kontrakter, internkontroll.

## Ingen provider — men flaten må males

Komponentene trenger **ingen** wrapper, kontekst eller tema-provider. De importeres og
brukes direkte. Til gjengjeld er det én ting som må gjøres, og som ikke skjer av seg selv:

Temaet ligger som CSS-variabler på `:root` (**mørkt er standard**) og på
`[data-theme="light"]`. Ingen av dem setter bakgrunn eller tekstfarge på et element for deg.
Maler du ikke rotelementet ditt, får du lys tekst på hvit bakgrunn — usynlig.

```jsx
// Rota i enhver skjerm du bygger:
<div style={{ background: "var(--bg)", color: "var(--text)", fontFamily: "var(--font-sans)", minHeight: "100vh" }}>
  …
</div>
```

Lyst tema: sett `data-theme="light"` på samme element. Attributtet virker på et hvilket som
helst element, ikke bare `<html>`.

I eksemplene under `## Examples` i hver `.prompt.md` heter denne rota `flate` (eller `scene`
for komponenter som er `position: fixed`). Det er **stillas for forhåndsvisningskortene**,
ikke en eksport fra biblioteket — skriv stilobjektet ditt selv, som over.

## Stilen er CSS-klasser, ikke props

Komponentene tar ingen stil-props. Alt du bygger rundt dem — layout, knapper, merkelapper —
skrives med designsystemets egne klasser. **Ikke finn opp nye klassenavn, og ikke skriv
px-verdier for skrift.**

| Formål | Klasser |
|---|---|
| Flate | `.card`, `.card-header`, `.card-title`, `.card-body` |
| Listerad | `.list-item`, `.list-tittel`, `.list-meta` |
| Knapp | `.btn` + `.btn-primary` / `.btn-ghost` / `.btn-danger` |
| Skjema | `.field`, `.field-label`, `.field-note`, `.input`, `.select`, `.textarea` |
| Merkelapp | `.badge` + `.ok` / `.warn` / `.danger` / `.info` / `.muted` |
| Rutenett | `.auto-grid` (auto-fit, minmax 260px — brekker om seg selv) |
| Tomt/feil | `.tom-melding`, `.feilmelding` |
| Øvrig | `.avatar`, `.page-content`, `.nav-lenke` |

Tokens: farger `--bg`, `--surface`, `--surface2`, `--border`, `--text`, `--muted`,
`--accent` (+ `--accent-rgb` for `rgba(var(--accent-rgb), .12)`), `--accent2`, `--warn`,
`--danger`, `--shadow`. Skrift `--font-sans` og seks trinn: `--fs-label` 12px (**standard —
`body` har den**), `--fs-sm` 14, `--fs-md` 16, `--fs-lg` 20, `--fs-xl` 26, `--fs-hero` 40.

Tre regler fra kildefila, alle lært av feil:

1. **Bruk tokenene, aldri px** for skrift og farge.
2. **Alt som skal reagere på skjermbredde må være en CSS-klasse.** Inline `style` kan ikke
   media queries — `gridTemplateColumns: "repeat(4, 1fr)"` gir fire kolonner også på 375px.
   Bruk `.auto-grid`.
3. **Skriv aldri et skriftnavn.** `var(--font-sans)`. `button`, `input`, `select` og
   `textarea` arver ikke font av seg selv — de må få den.

En `<button>` arver heller ikke `color`: skriver du `background: none`, må `color: inherit`
med, ellers blir teksten svart på mørk flate.

## Hvor fasiten står

- `_ds/<mappe>/styles.css` og importene den drar inn — hele klasse- og tokenlaget, ordrett
  fra appen. Les den før du finner på noe eget.
- `components/<gruppe>/<Navn>/<Navn>.prompt.md` — props og ekte eksempler per komponent.
- Gruppene: **Flater** (Kort, Rad, Nokkeltall, Tom, Feil), **Skjema** (Felt, Tekstfelt,
  Tekstomrade, Nedtrekk, Avkryssing, Bryter, Knapperad, Hurtigskjema), **Lag** (Modal,
  Skuff, Fanemodal, Kommer), **Navigasjon** (Faner).

Detaljvisninger er som regel `Fanemodal` eller `Skuff` over lista — ikke en egen side.
`Avkryssing` er for valg som lagres med skjemaet; `Bryter` for innstillinger som trer i
kraft med en gang.

## Et typisk bygg

```jsx
<div style={{ background: "var(--bg)", color: "var(--text)", fontFamily: "var(--font-sans)", minHeight: "100vh", padding: 20 }}>
  <div className="auto-grid" style={{ marginBottom: 16 }}>
    <Nokkeltall etikett="Åpne avvik" verdi={7} />
    <Nokkeltall etikett="Forfaller denne uka" verdi={3} />
  </div>

  <Kort tittel="Oppgaver denne uka" handling={<button className="btn btn-primary">Ny oppgave</button>}>
    <Rad
      tittel="Sjekk røykvarslere i fellesarealer"
      meta="Forfaller i morgen · Kristoffer Nornes"
      hoyre={<span className="badge warn">Forfaller</span>}
      onClick={() => setApen("14")}
    />
    <Rad tittel="Bytt lysrør i garasjenedkjørsel" meta="Forfalt 3 dager siden · ikke tildelt"
         hoyre={<span className="badge danger">Forsinket</span>} />
  </Kort>
</div>
```
