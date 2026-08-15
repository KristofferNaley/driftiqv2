import { Kort, Tom } from "@driftiq/designsystem";

const flate = {
  background: "var(--bg)",
  color: "var(--text)",
  fontFamily: "var(--font-sans)",
  padding: "16px",
  borderRadius: "10px",
} as const;

/** Tomtilstanden hører hjemme inni kortet, der lista ville stått. */
export const IKort = () => {
  return (
    <div style={flate}>
      <Kort tittel="Avvik denne måneden">
        <Tom tekst="Ingen avvik registrert." />
      </Kort>
    </div>
  );
}

/** Teksten skal si hva som mangler OG hva man gjør med det — ikke bare «ingen data». */
export const MedNesteSteg = () => {
  return (
    <div style={flate}>
      <Kort
        tittel="Kontrakter"
        handling={<button className="btn btn-primary">Ny kontrakt</button>}
      >
        <Tom tekst="Ingen kontrakter er registrert ennå. Legg inn den første for å få varsler før fornyelse." />
      </Kort>
    </div>
  );
}
