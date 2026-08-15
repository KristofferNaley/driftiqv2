import { Kort, Rad } from "@driftiq/designsystem";

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
      <Kort tittel="Kontrakter">
        <Rad tittel="Renhold trappeoppganger" meta="Vaktmestertjenester Vest AS · løper til 31.12.2026" />
        <Rad tittel="Årskontroll brannvarsling" meta="Bergen Brannteknikk AS · løper til 14.09.2026" />
      </Kort>
    </div>
  );
}

export const MedHoyrefelt = () => {
  return (
    <div style={flate}>
      <Kort tittel="Oppgaver denne uka">
        <Rad
          tittel="Sjekk røykvarslere i fellesarealer"
          meta="Forfaller i morgen · Kristoffer Nornes"
          hoyre={<span className="badge warn">Forfaller</span>}
        />
        <Rad
          tittel="Bytt lysrør i garasjenedkjørsel"
          meta="Forfalt 3 dager siden · ikke tildelt"
          hoyre={<span className="badge danger">Forsinket</span>}
        />
        <Rad
          tittel="Kontroller port og bom"
          meta="Utført 12.08.2026 · Vaktmestertjenester Vest AS"
          hoyre={<span className="badge muted">Utført</span>}
        />
      </Kort>
    </div>
  );
}

export const Klikkbar = () => {
  return (
    <div style={flate}>
      <Kort tittel="Leverandører">
        <Rad
          tittel="Heiskontrollen Norge AS"
          meta="Heis · kontakt: Marit Lie · 55 12 34 56"
          hoyre={<span className="list-meta">›</span>}
          onClick={() => {}}
        />
        <Rad
          tittel="Bergen Rørservice AS"
          meta="Rør og sanitær · kontakt: Ola Hansen"
          hoyre={<span className="list-meta">›</span>}
          onClick={() => {}}
        />
      </Kort>
    </div>
  );
}
