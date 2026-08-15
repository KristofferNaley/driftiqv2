import { useState } from "react";
import { Bryter, Kort } from "@driftiq/designsystem";

const flate = {
  background: "var(--bg)",
  color: "var(--text)",
  fontFamily: "var(--font-sans)",
  padding: "16px",
  borderRadius: "10px",
  minWidth: "320px",
} as const;

/**
 * Bryteren sier «dette er PÅ nå». Den brukes til innstillinger som trer i kraft med en
 * gang — typisk varsler. Skal valget lagres sammen med et skjema, bruk `Avkryssing`.
 */
export const Varselliste = () => {
  const [oppgaver, setOppgaver] = useState(true);
  const [avvik, setAvvik] = useState(true);
  const [sammendrag, setSammendrag] = useState(false);
  const [kontrakter, setKontrakter] = useState(true);

  return (
    <div style={flate}>
      <Kort tittel="Varsler på e-post">
        <div className="card-body">
          <Bryter
            etikett="Nye oppgaver"
            beskrivelse="Sendes når en oppgave tildeles deg."
            verdi={oppgaver}
            onEndre={setOppgaver}
          />
          <Bryter
            etikett="Avvik meldt inn"
            beskrivelse="Alle avvik i organisasjonene du er admin i."
            verdi={avvik}
            onEndre={setAvvik}
          />
          <Bryter
            etikett="Ukesammendrag"
            beskrivelse="Mandag morgen, med forfall de neste sju dagene."
            verdi={sammendrag}
            onEndre={setSammendrag}
          />
          <Bryter
            etikett="Kontrakt utløper"
            beskrivelse="60 dager før avtalt sluttdato."
            verdi={kontrakter}
            onEndre={setKontrakter}
          />
        </div>
      </Kort>
    </div>
  );
}

/** Beskrivelsen er valgfri — uten den blir raden én linje. */
export const UtenBeskrivelse = () => {
  const [pa, setPa] = useState(true);
  const [av, setAv] = useState(false);
  return (
    <div style={{ ...flate, display: "flex", flexDirection: "column" }}>
      <Bryter etikett="Vis utførte oppgaver" verdi={pa} onEndre={setPa} />
      <Bryter etikett="Vis arkiverte leverandører" verdi={av} onEndre={setAv} />
    </div>
  );
}
