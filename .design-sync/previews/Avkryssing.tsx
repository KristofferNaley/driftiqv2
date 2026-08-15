import { useState } from "react";
import { Avkryssing } from "@driftiq/designsystem";

const flate = {
  background: "var(--bg)",
  color: "var(--text)",
  fontFamily: "var(--font-sans)",
  padding: "16px",
  borderRadius: "10px",
  minWidth: "300px",
} as const;

/**
 * `Avkryssing` er for valg som lagres sammen med resten av skjemaet. Skal innstillingen
 * tre i kraft med en gang, er `Bryter` riktig komponent.
 */
export const Standard = () => {
  const [verdi, setVerdi] = useState(true);
  return (
    <div style={flate}>
      <Avkryssing etikett="Avviket er lukket" verdi={verdi} onEndre={setVerdi} />
    </div>
  );
}

export const MedNotat = () => {
  const [verdi, setVerdi] = useState(false);
  return (
    <div style={flate}>
      <Avkryssing
        etikett="Krev bilde ved utført oppgave"
        verdi={verdi}
        onEndre={setVerdi}
        notat="Gjelder alle oppgaver i denne rutinen."
      />
    </div>
  );
}

export const Gruppe = () => {
  const [ror, setRor] = useState(true);
  const [elektro, setElektro] = useState(false);
  const [brann, setBrann] = useState(true);
  return (
    <div style={{ ...flate, display: "flex", flexDirection: "column", gap: "8px" }}>
      <div className="field-label">Fagområder</div>
      <Avkryssing etikett="Rør og sanitær" verdi={ror} onEndre={setRor} />
      <Avkryssing etikett="Elektro" verdi={elektro} onEndre={setElektro} />
      <Avkryssing etikett="Brannvern" verdi={brann} onEndre={setBrann} />
    </div>
  );
}
