import { useState } from "react";
import { Knapperad, Modal, Nedtrekk, Tekstfelt, Tekstomrade } from "@driftiq/designsystem";

/**
 * `scene` er stillas for kortet, ikke en del av designsystemet.
 *
 * Modalen er `position: fixed`, og en fast plassert boks måler seg mot nærmeste
 * TRANSFORMERTE forelder — ikke mot siden. Korthylsen har `translateZ(0)` uten høyde, så
 * uten en scene med egen høyde blir modalen sentrert i en null-høy boks og klippet i
 * begge ender. I appen er det `body` som er flaten, og problemet finnes ikke.
 */
const scene = {
  height: "100dvh",
  transform: "translateZ(0)",
  background: "var(--bg)",
  fontFamily: "var(--font-sans)",
} as const;

export const Skjema = () => {
  const [navn, setNavn] = useState("Bergen Rørservice AS");
  const [kategori, setKategori] = useState("ror");
  const [notat, setNotat] = useState("Døgnvakt på telefon 55 12 34 56.");

  return (
    <div style={scene}>
      <Modal tittel="Ny leverandør" onLukk={() => {}}>
        <form style={{ display: "flex", flexDirection: "column", gap: "15px" }}>
          <Tekstfelt etikett="Navn" verdi={navn} onEndre={setNavn} />
          <Nedtrekk
            etikett="Kategori"
            verdi={kategori}
            onEndre={setKategori}
            valg={[
              { verdi: "ror", etikett: "Rør og sanitær" },
              { verdi: "brann", etikett: "Brannvern" },
              { verdi: "heis", etikett: "Heis" },
              { verdi: "renhold", etikett: "Renhold" },
            ]}
          />
          <Tekstomrade etikett="Notat" verdi={notat} onEndre={setNotat} rader={3} />
          <Knapperad onAvbryt={() => {}} sendEtikett="Opprett" />
        </form>
      </Modal>
    </div>
  );
}
