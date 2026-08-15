import { Hurtigskjema, Kort, Rad } from "@driftiq/designsystem";

const flate = {
  background: "var(--bg)",
  color: "var(--text)",
  fontFamily: "var(--font-sans)",
  padding: "16px",
  borderRadius: "10px",
} as const;

/** Plassen den er laget for: `handling` i korttoppen, over lista den fyller. */
export const IKorttopp = () => {
  return (
    <div style={flate}>
      <Kort
        tittel="Sjekkpunkter"
        handling={
          <Hurtigskjema
            plassholder="Nytt sjekkpunkt"
            onSend={async () => {}}
          />
        }
      >
        <Rad tittel="Rømningsveier er frie" meta="Punkt 1 av 4" />
        <Rad tittel="Brannslokkere er på plass og plombert" meta="Punkt 2 av 4" />
        <Rad tittel="Nødlys lyser" meta="Punkt 3 av 4" />
      </Kort>
    </div>
  );
}

export const EgenKnappetekst = () => {
  return (
    <div style={flate}>
      <Hurtigskjema plassholder="Navn på enhet" knapp="Opprett" onSend={async () => {}} />
    </div>
  );
}
