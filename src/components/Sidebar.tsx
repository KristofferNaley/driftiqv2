"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as ikoner from "lucide-react";
import { Settings } from "lucide-react";
import { menyFor } from "@/lib/moduler";
import { initialer } from "./felles";
import OrgVelger from "./OrgVelger";
import Temaknapp from "./Temaknapp";

/**
 * Sidemenyen. Punktene kommer fra `menyFor()` i lib/moduler.ts — samme fil som gaten på
 * serversiden leser.
 *
 * v1 hadde en egen `NAV`-liste her, atskilt fra modulregisteret. Glemte du å legge modulen
 * inn i den, fikk den gate, rute og katalogkort, men ble usynlig i menyen når den var
 * aktivert. Den feilen kan ikke oppstå nå.
 */
/**
 * Tallet på et menypunkt, eller `null` om det ikke skal vises.
 *
 * Bare to punkter har et: forsinkede oppgaver og åpne avvik. Det er de to som krever
 * handling — et merke på alt ville gjort alle like uviktige.
 */
function merke(
  nokkel: string,
  tall: { forsinkedeOppgaver: number; apneAvvik: number } | null,
): number | null {
  if (!tall) return null;
  if (nokkel === "tasks" && tall.forsinkedeOppgaver > 0) return tall.forsinkedeOppgaver;
  if (nokkel === "avvik" && tall.apneAvvik > 0) return tall.apneAvvik;
  return null;
}

export default function Sidebar({
  apen,
  sammenslatt,
  aktiverteModuler,
  oktKjent,
  bruker,
  tall,
  onLukk,
  onProfil,
  onSok,
}: {
  apen: boolean;
  sammenslatt: boolean;
  aktiverteModuler: string | null;
  bruker: { navn: string; tittel: string | null } | null;
  /** Merker på Oppgaver og Avvik. `null` før tallene er hentet — se kommentaren i Layout. */
  tall: { forsinkedeOppgaver: number; apneAvvik: number } | null;
  /** Er økten hentet? Før den er det, tegnes ingen punkter — se `menyFor`. */
  oktKjent: boolean;
  onLukk: () => void;
  /** Åpner «Min profil» — også eneste vei til utlogging. */
  onProfil: () => void;
  /** Åpner det globale søket. Knappen bor her; Cmd+K-lytteren bor i Layout. */
  onSok: () => void;
}) {
  const sti = usePathname();
  const grupper = menyFor(aktiverteModuler, oktKjent);

  return (
    <nav
      className={`sidebar${apen ? " apen" : ""}${sammenslatt ? " collapsed" : ""}`}
      aria-label="Hovedmeny"
    >
      {/* Logoen er et avrundet kvadrat med radius = 25 % av bredden, identisk med
          favicon.svg. Tegn den aldri på nytt fra en mockup.

          Kundens navn sto her en periode, men flyttet ned til org-velgeren rett over
          Dashboard — ellers sto det to ganger like under hverandre. */}
      <div className="sidebar-logo">
        <span className="logo-mark" aria-hidden>
          IQ
        </span>
        <span className="logo-tekst">
          Drift<span className="iq">IQ</span>
        </span>
      </div>

      {/* Org-en er kontekst for alt under, derfor over det første menypunktet. */}
      <OrgVelger />

      {/* Søket står mellom org-velgeren og menyen: det søker i DENNE org-en, på tvers av
          punktene under. Ser ut som et felt, er en knapp — selve feltet bor i modalen. */}
      <button type="button" className="sok-knapp" onClick={onSok} title="Søk i hele systemet">
        <ikoner.Search size={15} strokeWidth={2} aria-hidden />
        <span className="nav-tekst">Søk …</span>
        <kbd className="sok-kbd">⌘K</kbd>
      </button>

      <div className="sidebar-nav">
        {grupper.map((g) => (
          <div key={g.gruppe}>
            <div className="nav-gruppe">{g.gruppe}</div>
            {g.punkter.map((p) => {
              // Ikonnavnet er en streng i registeret, så den fila slipper å importere React.
              const Ikon = (ikoner as unknown as Record<string, ikoner.LucideIcon>)[p.ikon] ?? ikoner.Circle;
              const aktiv = p.sti === "/" ? sti === "/" : sti.startsWith(p.sti);
              return (
                <Link
                  key={p.nokkel}
                  href={p.sti}
                  className={`nav-lenke${aktiv ? " aktiv" : ""}`}
                  onClick={onLukk}
                  title={p.etikett}
                >
                  <Ikon size={17} strokeWidth={1.9} aria-hidden />
                  <span className="nav-tekst">{p.etikett}</span>
                  {/* Merket vises bare når tallet er over null. En permanent «0» er støy og
                      gjør at man slutter å legge merke til at det står noe der. */}
                  {merke(p.nokkel, tall) !== null && (
                    <span className={`nav-merke ${p.nokkel === "avvik" ? "avvik" : "oppgaver"}`}>
                      {merke(p.nokkel, tall)}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </div>

      {/* Temaveksleren over profilblokken, som i v1. */}
      <Temaknapp />

      {/* Profilblokken står NEDERST, som i v1: hvem du er innlogget som er kontekst du
          sjelden trenger, men alltid vil kunne finne. Navnet i toppbaren erstattes av den. */}
      {bruker && (
        <button className="profil-blokk" onClick={onProfil} title="Min profil">
          <span className="avatar accent">{initialer(bruker.navn)}</span>
          <div className="profil-tekst" style={{ minWidth: 0 }}>
            <div className="profil-navn">{bruker.navn}</div>
            {bruker.tittel && <div className="profil-tittel">{bruker.tittel}</div>}
          </div>
          <Settings size={15} strokeWidth={1.9} aria-hidden />
        </button>
      )}
    </nav>
  );
}
