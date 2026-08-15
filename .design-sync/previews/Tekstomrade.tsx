import { useState } from "react";
import { Tekstomrade } from "@driftiq/designsystem";

const flate = {
  background: "var(--bg)",
  color: "var(--text)",
  fontFamily: "var(--font-sans)",
  padding: "16px",
  borderRadius: "10px",
  minWidth: "300px",
} as const;

export const Standard = () => {
  const [verdi, setVerdi] = useState(
    "Rømningsveien i kjelleren var blokkert av lagrede sykler og en tilhengerdel. " +
      "Beboer i 3. etasje er varslet, og gangen skal være tom innen fredag.",
  );
  return (
    <div style={flate}>
      <Tekstomrade etikett="Beskrivelse" verdi={verdi} onEndre={setVerdi} />
    </div>
  );
}

/** `rader` gir den kompakte varianten — for korte tekster er standardhøyden et hull i skjemaet. */
export const Kompakt = () => {
  const [verdi, setVerdi] = useState("Døgnvakt på telefon 55 12 34 56.");
  return (
    <div style={flate}>
      <Tekstomrade
        etikett="Notat"
        verdi={verdi}
        onEndre={setVerdi}
        rader={2}
        notat="Vises på leverandørkortet."
      />
    </div>
  );
}

export const Tom = () => {
  const [verdi, setVerdi] = useState("");
  return (
    <div style={flate}>
      <Tekstomrade
        etikett="Tiltak"
        verdi={verdi}
        onEndre={setVerdi}
        plassholder="Hva skal gjøres, av hvem, og innen når?"
      />
    </div>
  );
}
