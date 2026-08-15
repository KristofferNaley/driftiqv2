import { useState } from "react";
import { Avkryssing, Knapperad, Nedtrekk, Skuff, Tekstomrade } from "@driftiq/designsystem";

/**
 * `scene` er stillas for kortet — se forklaringen i `Modal.tsx`. Skuffa er `position: fixed`
 * mot høyre kant og trenger en scene med høyde for ikke å kollapse.
 *
 * Poenget med skuffa framfor en modal er at lista bak blir stående: man justerer én rad
 * uten å miste konteksten. Her er lista antydet med en stripe bak skuffa.
 */
const scene = {
  height: "100dvh",
  transform: "translateZ(0)",
  background: "var(--bg)",
  fontFamily: "var(--font-sans)",
  padding: "20px",
  color: "var(--text)",
} as const;

export const Redigering = () => {
  const [tiltak, setTiltak] = useState(
    "Merke rømningsvei i kjeller og fjerne lagrede sykler fra gangen.",
  );
  const [ansvar, setAnsvar] = useState("styret");
  const [lukket, setLukket] = useState(false);

  return (
    <div style={scene}>
      <div className="card">
        <div className="card-header">
          <div className="card-title">Avvik</div>
        </div>
        <div className="list-item">
          <div>
            <div className="list-tittel">Avvik 14 — blokkert rømningsvei</div>
            <div className="list-meta">Meldt 11.08.2026 · kjeller</div>
          </div>
        </div>
        <div className="list-item">
          <div>
            <div className="list-tittel">Avvik 15 — lekkasje i garasje</div>
            <div className="list-meta">Meldt 13.08.2026 · plan U1</div>
          </div>
        </div>
      </div>

      <Skuff
        tittel="Avvik 14 — blokkert rømningsvei"
        onLukk={() => {}}
        fot={<Knapperad onAvbryt={() => {}} sendEtikett="Lagre" />}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "15px" }}>
          <Nedtrekk
            etikett="Ansvarlig"
            verdi={ansvar}
            onEndre={setAnsvar}
            valg={[
              { verdi: "styret", etikett: "Styret" },
              { verdi: "vaktmester", etikett: "Vaktmestertjenester Vest AS" },
              { verdi: "beboer", etikett: "Beboer i 3. etasje" },
            ]}
          />
          <Tekstomrade
            etikett="Tiltak"
            verdi={tiltak}
            onEndre={setTiltak}
            notat="Beskriv hva som faktisk skal gjøres, ikke bare at avviket er sett."
          />
          <Avkryssing
            etikett="Avviket er lukket"
            verdi={lukket}
            onEndre={setLukket}
            notat="Lukking krever at et tiltak er beskrevet."
          />
        </div>
      </Skuff>
    </div>
  );
}
