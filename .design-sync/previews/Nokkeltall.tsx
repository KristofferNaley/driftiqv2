import { Nokkeltall } from "@driftiq/designsystem";

const flate = {
  background: "var(--bg)",
  color: "var(--text)",
  fontFamily: "var(--font-sans)",
  padding: "16px",
  borderRadius: "10px",
} as const;

export const Enkelt = () => {
  return (
    <div style={flate}>
      <Nokkeltall etikett="Åpne avvik" verdi={7} />
    </div>
  );
}

/** Slik den faktisk står i oversiktene: fire fliser i `.auto-grid`, som brekker om selv. */
export const Rad = () => {
  return (
    <div style={flate}>
      <div className="auto-grid">
        <Nokkeltall etikett="Åpne avvik" verdi={7} />
        <Nokkeltall etikett="Forfaller denne uka" verdi={3} />
        <Nokkeltall etikett="Aktive kontrakter" verdi={12} />
        <Nokkeltall etikett="Leverandører" verdi={9} />
      </div>
    </div>
  );
}

/** Verdien er en `ReactNode` — den tåler et beløp, en enhet eller en merkelapp. */
export const SammensattVerdi = () => {
  return (
    <div style={flate}>
      <div className="auto-grid">
        <Nokkeltall etikett="Årlig kontraktsverdi" verdi="428 500 kr" />
        <Nokkeltall
          etikett="Siste vernerunde"
          verdi={<span style={{ fontSize: "var(--fs-lg)" }}>12. juni 2026</span>}
        />
      </div>
    </div>
  );
}
