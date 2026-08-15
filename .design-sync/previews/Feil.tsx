import { Feil, Kort, Tekstfelt } from "@driftiq/designsystem";

const flate = {
  background: "var(--bg)",
  color: "var(--text)",
  fontFamily: "var(--font-sans)",
  padding: "16px",
  borderRadius: "10px",
} as const;

/** Meldinga kommer fra API-ets `detail` — norsk, konkret, og aldri et statusnummer. */
export const Alene = () => {
  return (
    <div style={flate}>
      <Feil melding="Organisasjonsnummeret er allerede registrert på en annen leverandør." />
    </div>
  );
}

export const OverSkjema = () => {
  return (
    <div style={flate}>
      <Kort tittel="Ny leverandør">
        <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: "15px" }}>
          <Feil melding="Kunne ikke lagre: organisasjonsnummeret finnes ikke i Brønnøysundregistrene." />
          <Tekstfelt etikett="Organisasjonsnummer" verdi="923 353 149" onEndre={() => {}} />
        </div>
      </Kort>
    </div>
  );
}

/** `melding={null}` gjengir ingenting — komponenten står trygt i skjemaet hele tiden. */
export const Ingenting = () => {
  return (
    <div style={flate}>
      <Feil melding={null} />
      <div className="field-note">
        Med `melding={"{null}"}` gjengis ingenting. Komponenten kan derfor stå fast i skjemaet
        uten en betinget rundt seg.
      </div>
    </div>
  );
}
