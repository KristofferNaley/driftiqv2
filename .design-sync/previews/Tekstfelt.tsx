import { useState } from "react";
import { Tekstfelt } from "@driftiq/designsystem";

const flate = {
  background: "var(--bg)",
  color: "var(--text)",
  fontFamily: "var(--font-sans)",
  padding: "16px",
  borderRadius: "10px",
  minWidth: "260px",
} as const;

export const Standard = () => {
  const [verdi, setVerdi] = useState("Vaktmestertjenester Vest AS");
  return (
    <div style={flate}>
      <Tekstfelt etikett="Navn" verdi={verdi} onEndre={setVerdi} />
    </div>
  );
}

export const MedNotat = () => {
  const [verdi, setVerdi] = useState("923 353 143");
  return (
    <div style={flate}>
      <Tekstfelt
        etikett="Organisasjonsnummer"
        verdi={verdi}
        onEndre={setVerdi}
        notat="Ni siffer. Navn og adresse hentes fra Brønnøysundregistrene."
      />
    </div>
  );
}

export const Tom = () => {
  const [verdi, setVerdi] = useState("");
  return (
    <div style={flate}>
      <Tekstfelt
        etikett="Kontaktperson"
        verdi={verdi}
        onEndre={setVerdi}
        plassholder="Fornavn Etternavn"
      />
    </div>
  );
}

export const Laast = () => {
  return (
    <div style={flate}>
      <Tekstfelt
        etikett="E-post"
        verdi="post@vaktmestervest.no"
        onEndre={() => {}}
        laast
        notat="E-postadressen er innloggingsnøkkelen og kan ikke endres her."
      />
    </div>
  );
}
