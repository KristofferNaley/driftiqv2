"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as ikoner from "lucide-react";
import { Settings } from "lucide-react";
import { menyFor } from "@/lib/moduler";
import { initialer } from "./felles";

/**
 * Sidemenyen. Punktene kommer fra `menyFor()` i lib/moduler.ts — samme fil som gaten på
 * serversiden leser.
 *
 * v1 hadde en egen `NAV`-liste her, atskilt fra modulregisteret. Glemte du å legge modulen
 * inn i den, fikk den gate, rute og katalogkort, men ble usynlig i menyen når den var
 * aktivert. Den feilen kan ikke oppstå nå.
 */
export default function Sidebar({
  apen,
  sammenslatt,
  aktiverteModuler,
  oktKjent,
  bruker,
  versjon,
  onLukk,
  onProfil,
}: {
  apen: boolean;
  sammenslatt: boolean;
  aktiverteModuler: string | null;
  bruker: { navn: string; tittel: string | null } | null;
  /** Er økten hentet? Før den er det, tegnes ingen punkter — se `menyFor`. */
  oktKjent: boolean;
  versjon: string;
  onLukk: () => void;
  /** Åpner «Min profil» — også eneste vei til utlogging. */
  onProfil: () => void;
}) {
  const sti = usePathname();
  const grupper = menyFor(aktiverteModuler, oktKjent);

  return (
    <nav
      className={`sidebar${apen ? " apen" : ""}${sammenslatt ? " collapsed" : ""}`}
      aria-label="Hovedmeny"
    >
      <div className="sidebar-logo">
        {/* Logoen er et avrundet kvadrat med radius = 25 % av bredden, identisk med
            favicon.svg. Tegn den aldri på nytt fra en mockup. */}
        <span className="logo-mark" aria-hidden>
          IQ
        </span>
        <span className="logo-tekst">
          Drift<span className="iq">IQ</span>
        </span>
      </div>

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
                </Link>
              );
            })}
          </div>
        ))}
      </div>

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
      <div className="sidebar-fot">v{versjon}</div>
    </nav>
  );
}
