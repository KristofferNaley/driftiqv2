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
import ProfilModal from "@/components/ProfilModal";
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
  Menu,
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

export function Ramme({
  tittel,
  handlinger,
  children,
}: {
  tittel: string;
  /**
   * Sidens handlingsknapper, i toppbaren til høyre. Samme prop og samme rolle som i
   * kunde-appens `Layout` — knappene skal ligge samme sted i begge flatene.
   *
   * Før dette lå de i en flexrad sammen med et avsnitt forklarende tekst øverst i
   * innholdet. På mobil brøt raden: tre linjer tekst, så knappene på egen linje, og
   * innholdet begynte en halv skjerm nede.
   */
  handlinger?: ReactNode;
  children: ReactNode;
}) {
  const { bruker } = useOkt();
  const sti = usePathname();
  /**
   * Profilen, med `orgId={null}`.
   *
   * Panelet er den ENESTE flaten en plattformadmin uten medlemskap i et lag ser — og uten
   * dette hadde nettopp de kontoene, de med mest makt, ikke hatt noen vei til å skru på
   * tofaktor selv. Modalen er den samme som i kunde-appen, ikke en kopi: den tar allerede
   * `orgId: string | null` og skjuler fanene som ikke gir mening uten et lag.
   */
  const [profilApen, setProfilApen] = useState(false);
  // Absolutt til appverten når vertene er delt: /dashboard er 404 her.
  const appLenke = useAppLenke();

  /**
   * Menyen som skuff på mobil — samme mekanikk som kunde-appens `Layout`/`Sidebar`.
   *
   * Panelet hadde ingen: under 900px ble sidemenyen brettet om til en flettet rad som tok
   * 600px av skjermen før innholdet begynte, og `.pf-meny-fot` ble skjult — altså ingen vei
   * til profilen, temaet eller kunde-appen fra telefonen i det hele tatt.
   *
   * Ingen `collapsed`-variant som i appen: panelet har ingen ikonmodus å slå over til, og
   * en tilstand som huskes mellom besøk gir lite når menyen uansett bare er 11 punkter.
   */
  const [menyApen, setMenyApen] = useState(false);

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
      {menyApen && <div className="sidebar-backdrop" onClick={() => setMenyApen(false)} />}
      <nav className={`pf-meny${menyApen ? " apen" : ""}`} aria-label="Plattformmeny">
        <Link href="/plattform" className="pf-merke" onClick={() => setMenyApen(false)}>
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
            <Link
              key={p.sti}
              href={p.sti}
              className={`pf-lenke${aktiv ? " aktiv" : ""}`}
              onClick={() => setMenyApen(false)}
            >
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
            <button
              type="button"
              className="pf-bruker-blokk"
              onClick={() => setProfilApen(true)}
              title="Din profil, passord og tofaktor"
            >
              <span className="pf-mark liten" aria-hidden>{initialer(bruker.name)}</span>
              <span style={{ minWidth: 0 }}>
                <span className="pf-navn">{bruker.name}</span>
                <span className="pf-under">
                  {erPlattformadminRolle(bruker.role) ? "Plattformadmin" : "Ingen tilgang"}
                </span>
              </span>
            </button>
          )}
        </div>
      </nav>

      {/* Toppbaren gjelder alle bredder, som i kunde-appen: tittel til venstre, handlinger
          til høyre. ☰ vises bare under 900px — over det står menyen der permanent, og
          panelet har ingen sammenslått ikonmodus å veksle til. */}
      <div className="pf-hoved">
        <header className="pf-topp">
          <button
            type="button"
            className="menu-btn"
            onClick={() => setMenyApen(true)}
            aria-label="Vis meny"
            aria-expanded={menyApen}
          >
            <Menu size={20} strokeWidth={2} aria-hidden />
          </button>
          <h1 className="pf-topp-tittel">{tittel}</h1>
          {handlinger && <div className="pf-topp-handlinger">{handlinger}</div>}
        </header>

        <main className="pf-innhold">{children}</main>
      </div>

      {profilApen && (
        <ProfilModal
          orgId={null}
          onLukk={() => setProfilApen(false)}
          // Navnet står i brukerblokken nede til venstre, så en endring må hentes på nytt.
          onLagret={() => window.location.reload()}
        />
      )}
    </div>
  );
}
