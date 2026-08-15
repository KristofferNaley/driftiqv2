import { CreditCard, Plug } from "lucide-react";
import { Kommer } from "@driftiq/designsystem";

const flate = {
  background: "var(--bg)",
  color: "var(--text)",
  fontFamily: "var(--font-sans)",
  padding: "16px",
  borderRadius: "10px",
} as const;

/**
 * Punktene skal være konkrete. En fane som bare sier «kommer snart» er et løfte uten
 * innhold — en liste over hva som skal stå der, kan brukeren si seg uenig i.
 */
export const MedIkon = () => {
  return (
    <div style={flate}>
      <Kommer
        Ikon={Plug}
        tekst="Kobling mot regnskap og nøkkelsystem."
        punkter={[
          "Fakturaer fra regnskapssystemet inn på kontrakten",
          "Nøkkelbrikker knyttet til beboer og enhet",
          "Eksport av avvikslogg til revisor",
        ]}
        notat="Venter på at kontraktsmodulen er ferdig — den eier fakturakoblingen."
      />
    </div>
  );
}

export const UtenNotat = () => {
  return (
    <div style={flate}>
      <Kommer
        Ikon={CreditCard}
        tekst="Felleskostnader og betaling."
        punkter={[
          "Oversikt over utestående per enhet",
          "Purring med KID-nummer",
          "Historikk per beboer",
        ]}
      />
    </div>
  );
}
