import { Felt } from "@driftiq/designsystem";

const flate = {
  background: "var(--bg)",
  color: "var(--text)",
  fontFamily: "var(--font-sans)",
  padding: "16px",
  borderRadius: "10px",
  minWidth: "280px",
} as const;

/**
 * `Felt` er etikettramma de andre skjemakomponentene bygger på. Bruk den direkte når
 * kontrollen ikke finnes som ferdig komponent — en datovelger, to felter side om side,
 * en filopplaster.
 */
export const EgenKontroll = () => {
  return (
    <div style={flate}>
      <Felt etikett="Forfallsdato" notat="Varsel sendes 14 dager før.">
        <input className="input" type="date" defaultValue="2026-09-14" />
      </Felt>
    </div>
  );
}

export const ToPaaRad = () => {
  return (
    <div style={flate}>
      <Felt etikett="Gyldighetsperiode" notat="Tom sluttdato betyr løpende avtale.">
        <div style={{ display: "flex", gap: "10px" }}>
          <input className="input" type="date" defaultValue="2026-01-01" />
          <input className="input" type="date" defaultValue="2026-12-31" />
        </div>
      </Felt>
    </div>
  );
}

/** Uten `notat` er ramma bare etikett og kontroll. Her en segmentrad bygget av `.btn`. */
export const UtenNotat = () => {
  return (
    <div style={flate}>
      <Felt etikett="Alvorlighet">
        <div style={{ display: "flex", gap: "8px" }}>
          <button type="button" className="btn btn-ghost">
            Lav
          </button>
          <button type="button" className="btn btn-primary">
            Middels
          </button>
          <button type="button" className="btn btn-ghost">
            Høy
          </button>
        </div>
      </Felt>
    </div>
  );
}
