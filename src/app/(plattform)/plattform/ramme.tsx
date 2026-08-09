"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useOkt } from "@/components/OktProvider";

/**
 * Skallet rundt plattformsidene.
 *
 * Mørk topplinje med tydelig «PLATTFORM»-merke: panelet skal aldri kunne forveksles med
 * kunde-appen. De deler origin (se layout.tsx), så det visuelle skillet er det eneste som
 * minner deg på hvor du står.
 */
export function Ramme({ tittel, children }: { tittel: string; children: ReactNode }) {
  const { bruker } = useOkt();

  return (
    <div className="pf-side">
      <header className="pf-topp">
        <Link href="/plattform" className="pf-merke">
          <span className="logo-mark" aria-hidden>IQ</span>
          <span>
            Drift<span className="iq">IQ</span> <span className="pf-tag">PLATTFORM</span>
          </span>
        </Link>
        <div className="pf-topp-hoyre">
          {bruker && <span className="pf-dempet">{bruker.name}</span>}
          <Link className="btn btn-ghost" href="/">
            Til kunde-appen
          </Link>
        </div>
      </header>
      <main className="pf-innhold">
        <h1 className="pf-tittel">{tittel}</h1>
        {children}
      </main>
    </div>
  );
}
