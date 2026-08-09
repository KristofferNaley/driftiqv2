/**
 * Plassholder. Fase 0 leverer fundamentet — database, RLS-håndheving og testsuite — ikke UI.
 * Sidene kommer modul for modul i fase 2, med Parkering eller Årshjul først.
 */
export default function Forside() {
  return (
    <main style={{ fontFamily: "system-ui", padding: "40px", maxWidth: "640px" }}>
      <h1 style={{ fontSize: "20px" }}>DriftIQ v2</h1>
      <p style={{ color: "#8892a4", lineHeight: 1.6 }}>
        Fase 0: fundament. Ingen moduler er portert ennå — se <code>v2/README.md</code> for
        status og neste steg.
      </p>
    </main>
  );
}
