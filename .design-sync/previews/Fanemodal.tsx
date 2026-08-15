import { useState } from "react";
import { Bell, Building2, KeyRound, Plug, User } from "lucide-react";
import { Bryter, Fanemodal, Kommer, Knapperad, Tekstfelt } from "@driftiq/designsystem";

type Fane = "profil" | "varsler" | "passord" | "org" | "integrasjoner";

const faner = [
  { nokkel: "profil", etikett: "Profil", Ikon: User },
  { nokkel: "varsler", etikett: "Varsler", Ikon: Bell, endret: true },
  { nokkel: "passord", etikett: "Passord", Ikon: KeyRound },
  { nokkel: "org", etikett: "Organisasjon", Ikon: Building2 },
  { nokkel: "integrasjoner", etikett: "Integrasjoner", Ikon: Plug, kommer: true },
] as const;

/**
 * `scene` er stillas for kortet — se forklaringen i `Modal.tsx`. Fanemodalen er
 * `position: fixed` og trenger en forelder med høyde for ikke å bli klippet.
 */
const scene = {
  height: "100dvh",
  transform: "translateZ(0)",
  background: "var(--bg)",
  fontFamily: "var(--font-sans)",
} as const;

export const Profilmodal = () => {
  const [valgt, setValgt] = useState<Fane>("profil");
  const [navn, setNavn] = useState("Kristoffer Nornes");
  const [telefon, setTelefon] = useState("941 22 830");
  const [epost, setEpost] = useState(true);
  const [avvik, setAvvik] = useState(true);
  const [ukesammendrag, setUkesammendrag] = useState(false);

  return (
    <div style={scene}>
    <Fanemodal
      tittel="Min profil"
      onLukk={() => {}}
      faner={faner}
      valgt={valgt}
      onVelg={setValgt}
      topp={
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div className="avatar">KN</div>
          <div style={{ minWidth: 0 }}>
            <div className="list-tittel">Kristoffer Nornes</div>
            <div className="list-meta">kristoffer@hg9.no · Kontoadmin i Håsteinsgate 9</div>
          </div>
        </div>
      }
      fot={<Knapperad onAvbryt={() => {}} sendEtikett="Lagre" />}
    >
      {valgt === "profil" && (
        <>
          <Tekstfelt etikett="Navn" verdi={navn} onEndre={setNavn} />
          <Tekstfelt
            etikett="Telefon"
            verdi={telefon}
            onEndre={setTelefon}
            notat="Brukes bare til varsler du selv har slått på."
          />
        </>
      )}
      {valgt === "varsler" && (
        <>
          <Bryter
            etikett="E-post ved nye oppgaver"
            beskrivelse="Sendes når en oppgave tildeles deg."
            verdi={epost}
            onEndre={setEpost}
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
            verdi={ukesammendrag}
            onEndre={setUkesammendrag}
          />
        </>
      )}
      {valgt === "passord" && (
        <>
          <Tekstfelt etikett="Nytt passord" verdi="" onEndre={() => {}} type="password" />
          <Tekstfelt etikett="Gjenta nytt passord" verdi="" onEndre={() => {}} type="password" />
        </>
      )}
      {valgt === "org" && (
        <Tekstfelt
          etikett="Organisasjon"
          verdi="Håsteinsgate 9 Borettslag"
          onEndre={() => {}}
          laast
          notat="Byttes i toppmenyen. Her vises bare den aktive."
        />
      )}
      {valgt === "integrasjoner" && (
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
      )}
    </Fanemodal>
    </div>
  );
}
