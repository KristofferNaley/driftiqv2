import { useState } from "react";
import { Nedtrekk } from "@driftiq/designsystem";

const flate = {
  background: "var(--bg)",
  color: "var(--text)",
  fontFamily: "var(--font-sans)",
  padding: "16px",
  borderRadius: "10px",
  minWidth: "300px",
} as const;

export const Standard = () => {
  const [verdi, setVerdi] = useState("brann");
  return (
    <div style={flate}>
      <Nedtrekk
        etikett="Kategori"
        verdi={verdi}
        onEndre={setVerdi}
        valg={[
          { verdi: "brann", etikett: "Brannvern" },
          { verdi: "heis", etikett: "Heis" },
          { verdi: "ror", etikett: "Rør og sanitær" },
          { verdi: "renhold", etikett: "Renhold" },
          { verdi: "elektro", etikett: "Elektro" },
        ]}
      />
    </div>
  );
}

/** Tomvalget legges inn som et vanlig alternativ — komponenten har ingen egen plassholder. */
export const MedTomvalg = () => {
  const [verdi, setVerdi] = useState("");
  return (
    <div style={flate}>
      <Nedtrekk
        etikett="Ansvarlig"
        verdi={verdi}
        onEndre={setVerdi}
        notat="Uten ansvarlig havner oppgaven i «ikke tildelt»."
        valg={[
          { verdi: "", etikett: "— velg ansvarlig —" },
          { verdi: "kn", etikett: "Kristoffer Nornes" },
          { verdi: "ml", etikett: "Marit Lie" },
          { verdi: "vv", etikett: "Vaktmestertjenester Vest AS" },
        ]}
      />
    </div>
  );
}
