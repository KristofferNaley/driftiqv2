import { Knapperad } from "@driftiq/designsystem";

const flate = {
  background: "var(--bg)",
  color: "var(--text)",
  fontFamily: "var(--font-sans)",
  padding: "16px",
  borderRadius: "10px",
  minWidth: "320px",
} as const;

/** Primærhandlingen står til høyre — samme rekkefølge overalt i appen. */
export const Standard = () => {
  return (
    <div style={flate}>
      <Knapperad onAvbryt={() => {}} />
    </div>
  );
}

export const EgneEtiketter = () => {
  return (
    <div style={flate}>
      <Knapperad onAvbryt={() => {}} avbrytEtikett="Tilbake" sendEtikett="Opprett kontrakt" />
    </div>
  );
}

/** Under sending bytter knappen tekst til «Lagrer …» og deaktiveres. */
export const Sender = () => {
  return (
    <div style={flate}>
      <Knapperad onAvbryt={() => {}} sender />
    </div>
  );
}

/** `farlig` for handlinger som ikke kan angres — sletting, deaktivering. */
export const Farlig = () => {
  return (
    <div style={flate}>
      <Knapperad
        onAvbryt={() => {}}
        sendEtikett="Slett leverandør"
        farlig
        onSend={() => {}}
      />
    </div>
  );
}

/** `deaktivert` når skjemaet ikke er gyldig ennå. */
export const Deaktivert = () => {
  return (
    <div style={flate}>
      <Knapperad onAvbryt={() => {}} deaktivert />
    </div>
  );
}
