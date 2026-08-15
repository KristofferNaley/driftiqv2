import { Kort, Rad, Tom } from "@driftiq/designsystem";

/**
 * `flate` er stillas for kortet i biblioteket, ikke en del av designsystemet.
 * Appen setter `data-theme` på `<html>` og lar `body` eie bakgrunnen; her må hver
 * forhåndsvisning male sin egen flate for at mørkt tema skal se ut som seg selv.
 */
const flate = {
  background: "var(--bg)",
  color: "var(--text)",
  fontFamily: "var(--font-sans)",
  padding: "16px",
  borderRadius: "10px",
} as const;

export const Standard = () => {
  return (
    <div style={flate}>
      <Kort tittel="Neste forfall">
        <div className="card-body">
          Brannvarslingsanlegget har årskontroll 14. september. Serviceavtalen med Bergen
          Brannteknikk dekker kontrollen; rapporten legges i Internkontroll når den er utført.
        </div>
      </Kort>
    </div>
  );
}

export const MedHandling = () => {
  return (
    <div style={flate}>
      <Kort
        tittel="Leverandører"
        handling={<button className="btn btn-primary">Ny leverandør</button>}
      >
        <Rad tittel="Vaktmestertjenester Vest AS" meta="Renhold og uteområder · 4 kontrakter" />
        <Rad tittel="Bergen Brannteknikk AS" meta="Brannvern · 2 kontrakter" />
        <Rad tittel="Heiskontrollen Norge AS" meta="Heis · 1 kontrakt" />
      </Kort>
    </div>
  );
}

export const MedTomListe = () => {
  return (
    <div style={flate}>
      <Kort tittel="Avvik denne måneden">
        <Tom tekst="Ingen avvik registrert." />
      </Kort>
    </div>
  );
}

export const LystTema = () => {
  return (
    <div data-theme="light" style={flate}>
      <Kort tittel="Neste forfall">
        <div className="card-body">
          Samme kort i lyst tema. Fargene kommer fra tokenene på `[data-theme=&quot;light&quot;]`
          — komponenten er den samme.
        </div>
      </Kort>
    </div>
  );
}
