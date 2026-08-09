"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useOkt } from "@/components/OktProvider";
import { initialer } from "@/components/felles";
import { erPlattformadminRolle } from "@/lib/nivaer";
import { useAppLenke } from "../verter";

/**
 * Skallet rundt plattformsidene.
 *
 * ## Lilla, ikke blått
 *
 * Panelet og kunde-appen deler origin (se layout.tsx), så det VISUELLE skillet er det eneste
 * som til enhver tid minner deg på hvor du står. Første utkast brukte appens egen blåfarge,
 * og da forsvant hele poenget: to flater som ser like ut, men der den ene administrerer alle
 * kunder. Lilla er valgt fordi den ikke finnes i kundepaletten i det hele tatt.
 */

const MENY = [
  { sti: "/plattform", etikett: "Dashboard" },
  { sti: "/plattform/kunder", etikett: "Kunder" },
  { sti: "/plattform/leads", etikett: "Henvendelser" },
  { sti: "/plattform/brukere", etikett: "Plattformbrukere" },
  { sti: "/plattform/support", etikett: "Support-modus" },
];

export function Ramme({ tittel, children }: { tittel: string; children: ReactNode }) {
  const { bruker } = useOkt();
  const sti = usePathname();
  // Absolutt til appverten når vertene er delt: /dashboard er 404 her.
  const appLenke = useAppLenke();

  return (
    <div className="pf-side">
      <nav className="pf-meny">
        <Link href="/plattform" className="pf-merke">
          <span className="pf-mark" aria-hidden>
            {bruker ? initialer(bruker.name) : "PA"}
          </span>
          <span>
            Drift<span className="iq">IQ</span>
            <span className="pf-tag">PLATTFORM</span>
          </span>
        </Link>

        <div className="pf-meny-gruppe">Plattformadmin</div>
        {MENY.map((p) => {
          // Eksakt treff på forsiden, prefiks ellers — uten det ville «Dashboard» stått
          // markert på hver eneste underside.
          const aktiv = p.sti === "/plattform" ? sti === p.sti : sti.startsWith(p.sti);
          return (
            <Link key={p.sti} href={p.sti} className={`pf-lenke${aktiv ? " aktiv" : ""}`}>
              {p.etikett}
            </Link>
          );
        })}

        <div className="pf-meny-fot">
          <a className="pf-tilbake" href={appLenke}>
            ← Til kunde-appen
          </a>
          {bruker && (
            <div className="pf-bruker-blokk">
              <span className="pf-mark liten" aria-hidden>{initialer(bruker.name)}</span>
              <span style={{ minWidth: 0 }}>
                <span className="pf-navn">{bruker.name}</span>
                <span className="pf-under">
                  {erPlattformadminRolle(bruker.role) ? "Plattformadmin" : "Ingen tilgang"}
                </span>
              </span>
            </div>
          )}
        </div>
      </nav>

      <main className="pf-innhold">
        <h1 className="pf-tittel">{tittel}</h1>
        {children}
      </main>
    </div>
  );
}
