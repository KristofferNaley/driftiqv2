import { useState } from "react";
import { Faner, Kort, Rad, Tom } from "@driftiq/designsystem";

const flate = {
  background: "var(--bg)",
  color: "var(--text)",
  fontFamily: "var(--font-sans)",
  padding: "16px",
  borderRadius: "10px",
} as const;

type Fane = "rutiner" | "runder" | "avvik";

/** Fanerada hører hjemme i `subnav` — rett under sidetittelen, over innholdet. */
export const MedInnhold = () => {
  const [valgt, setValgt] = useState<Fane>("runder");

  return (
    <div style={flate}>
      <div style={{ borderBottom: "1px solid var(--border)", marginBottom: "16px" }}>
        <Faner
          valgt={valgt}
          faner={[
            { nokkel: "rutiner", etikett: "Rutiner" },
            { nokkel: "runder", etikett: "Vernerunder" },
            { nokkel: "avvik", etikett: "Avvik" },
          ]}
          onVelg={setValgt}
        />
      </div>

      {valgt === "rutiner" && (
        <Kort tittel="Rutiner">
          <Rad tittel="Månedlig kontroll av fellesarealer" meta="12 sjekkpunkter · neste 01.09.2026" />
          <Rad tittel="Årlig brannvernrunde" meta="21 sjekkpunkter · neste 14.09.2026" />
        </Kort>
      )}
      {valgt === "runder" && (
        <Kort tittel="Vernerunder">
          <Rad
            tittel="Vernerunde august"
            meta="Utført 12.08.2026 · 2 avvik"
            hoyre={<span className="badge ok">Fullført</span>}
          />
          <Rad
            tittel="Vernerunde september"
            meta="Planlagt 09.09.2026"
            hoyre={<span className="badge muted">Planlagt</span>}
          />
        </Kort>
      )}
      {valgt === "avvik" && (
        <Kort tittel="Avvik">
          <Tom tekst="Ingen åpne avvik." />
        </Kort>
      )}
    </div>
  );
}

/** To faner er minimum — under det er en fanerad bare støy. */
export const ToFaner = () => {
  const [valgt, setValgt] = useState<"aktive" | "arkiv">("aktive");
  return (
    <div style={flate}>
      <Faner
        valgt={valgt}
        faner={[
          { nokkel: "aktive", etikett: "Aktive" },
          { nokkel: "arkiv", etikett: "Arkiv" },
        ]}
        onVelg={setValgt}
      />
    </div>
  );
}
