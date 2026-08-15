"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useOkt } from "@/components/OktProvider";
import { initialer } from "@/components/felles";
import { api } from "@/lib/klient";
import { erPlattformadminRolle } from "@/lib/nivaer";
import { useAppLenke } from "../verter";
import Temaknapp from "@/components/Temaknapp";
import {
  Activity,
  BarChart3,
  Bug,
  Building2,
  Coins,
  Inbox,
  Landmark,
  LayoutGrid,
  LayoutTemplate,
  Search,
  Users,
  type LucideIcon,
} from "lucide-react";

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

/**
 * Menypunktene, i samme rekkefølge og med samme navn og ikoner som v1.
 *
 * Navnene ble «forbedret» i første utkast — «Innmeldinger», «Henvendelser»,
 * «Plattformbrukere», «HMS-maler». Det var å finne opp nye ord for ting som allerede har
 * et navn du bruker daglig. Tilbake til v1s.
 *
 * Stiene er urørt: `/plattform/saker` heter fortsatt det, selv om punktet heter
 * «Feilmeldinger». En URL som byttes brekker bokmerker uten å gi noe tilbake.
 */
const MENY: ReadonlyArray<{ sti: string; etikett: string; ikon: LucideIcon }> = [
  { sti: "/plattform", etikett: "Dashboard", ikon: LayoutGrid },
  { sti: "/plattform/statistikk", etikett: "Statistikk", ikon: BarChart3 },
  { sti: "/plattform/leads", etikett: "Leads", ikon: Inbox },
  { sti: "/plattform/saker", etikett: "Feilmeldinger", ikon: Bug },
  { sti: "/plattform/kunder", etikett: "Kunder", ikon: Building2 },
  { sti: "/plattform/boligbyggelag", etikett: "Boligbyggelag", ikon: Landmark },
  { sti: "/plattform/prismodell", etikett: "Prismodell", ikon: Coins },
  { sti: "/plattform/brukere", etikett: "Brukere", ikon: Users },
  { sti: "/plattform/support", etikett: "Support-modus", ikon: Search },
  { sti: "/plattform/maler", etikett: "Maler", ikon: LayoutTemplate },
  // Ikke i v1s meny, men bygget i v2 — systemhelse hører hjemme her og ikke gjemt bort.
  { sti: "/plattform/system", etikett: "System", ikon: Activity },
];

export function Ramme({ tittel, children }: { tittel: string; children: ReactNode }) {
  const { bruker } = useOkt();
  const sti = usePathname();
  // Absolutt til appverten når vertene er delt: /dashboard er 404 her.
  const appLenke = useAppLenke();

  // Åpne saker som teller på «Feilmeldinger» — innboksen skal synes uten å åpnes.
  // Feiler kallet, vises bare ingen teller; menyen skal aldri velte på det.
  const [apneSaker, setApneSaker] = useState(0);
  useEffect(() => {
    if (!bruker || !erPlattformadminRolle(bruker.role)) return;
    api
      .hent<{ antall: number }>("/plattform/saker/antall")
      .then((r) => setApneSaker(r.antall))
      .catch(() => {});
  }, [bruker]);

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
          const Ikon = p.ikon;
          return (
            <Link key={p.sti} href={p.sti} className={`pf-lenke${aktiv ? " aktiv" : ""}`}>
              <Ikon size={17} strokeWidth={1.9} aria-hidden />
              <span>{p.etikett}</span>
              {p.sti === "/plattform/saker" && apneSaker > 0 && (
                <span className="pf-cnt" aria-label={`${apneSaker} åpne saker`}>{apneSaker}</span>
              )}
            </Link>
          );
        })}

        <div className="pf-meny-fot">
          <div className="pf-fot-rad">
            <a className="pf-tilbake" href={appLenke}>
              ← Tilbake til kunde-appen
            </a>
            {/* Temaveksleren står også her, som i v1 — panelet er en egen flate og man
                skal ikke måtte innom kunde-appen for å bytte. */}
            <Temaknapp kompakt />
          </div>
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
