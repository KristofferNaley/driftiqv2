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
  ArrowLeft,
  BarChart3,
  Building2,
  CalendarCheck,
  Inbox,
  Menu,
  MessageSquareWarning,
  Settings,
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

type Teller = "iDag" | "innmeldinger";
type Punkt = { sti: string; etikett: string; ikon: LucideIcon; teller?: Teller };

/**
 * Menyen: seks punkter, gruppert etter jobb (01.10.2026).
 *
 * Før var det elleve flate punkter i v1s rekkefølge, der det man gjør hver gang (kø, leads,
 * kunder) sto blandet med det man setter opp en gang i halvåret (prismodell, maler, system).
 * Det siste er samlet under Innstillinger nederst; de gamle stiene omdirigerer dit.
 *
 * Punktet heter «Innmeldinger», som siden selv — det dekker feil, forslag og spørsmål, og
 * «Feilmeldinger» i menyen over en side som heter noe annet var å ha to navn på én ting.
 * Stien er fortsatt `/plattform/saker`: en URL som byttes brekker bokmerker.
 */
const MENY: ReadonlyArray<{ gruppe: string | null; punkter: ReadonlyArray<Punkt> }> = [
  {
    gruppe: null,
    punkter: [
      { sti: "/plattform", etikett: "I dag", ikon: CalendarCheck, teller: "iDag" },
      { sti: "/plattform/saker", etikett: "Innmeldinger", ikon: MessageSquareWarning, teller: "innmeldinger" },
    ],
  },
  {
    gruppe: "Salg og kunder",
    punkter: [
      { sti: "/plattform/leads", etikett: "Leads", ikon: Inbox },
      { sti: "/plattform/kunder", etikett: "Kunder", ikon: Building2 },
    ],
  },
  {
    gruppe: "Innsikt",
    punkter: [{ sti: "/plattform/statistikk", etikett: "Statistikk", ikon: BarChart3 }],
  },
];

const INNSTILLINGER: Punkt = { sti: "/plattform/innstillinger", etikett: "Innstillinger", ikon: Settings };

const TELLER_TEKST: Record<Teller, (n: number) => string> = {
  iDag: (n) => `${n} ${n === 1 ? "punkt krever" : "punkter krever"} handling`,
  innmeldinger: (n) => `${n} ${n === 1 ? "sak venter" : "saker venter"} på svar`,
};

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
   * en tilstand som huskes mellom besøk gir lite når menyen uansett bare er seks punkter.
   */
  const [menyApen, setMenyApen] = useState(false);

  // Tellerne på «I dag» og «Innmeldinger». Hentes på nytt ved hvert sidebytte, så et
  // svar på en sak eller en løst regel synes i menyen uten omlasting. Feiler kallet, vises
  // bare ingen teller; menyen skal aldri velte på det.
  const [tellere, setTellere] = useState<Partial<Record<Teller, number>>>({});
  useEffect(() => {
    if (!bruker || !erPlattformadminRolle(bruker.role)) return;
    api
      .hent<Partial<Record<Teller, number>>>("/plattform/tellere")
      .then(setTellere)
      .catch(() => {});
  }, [bruker, sti]);

  // Eksakt treff på forsiden, prefiks ellers — uten det ville «I dag» stått markert på hver
  // eneste underside.
  const lenke = (p: Punkt) => {
    const aktiv = p.sti === "/plattform" ? sti === p.sti : sti.startsWith(p.sti);
    const Ikon = p.ikon;
    const n = p.teller ? (tellere[p.teller] ?? 0) : 0;
    return (
      <Link
        key={p.sti}
        href={p.sti}
        className={`pf-lenke${aktiv ? " aktiv" : ""}`}
        aria-current={aktiv ? "page" : undefined}
        onClick={() => setMenyApen(false)}
      >
        <Ikon size={17} strokeWidth={1.9} aria-hidden />
        <span>{p.etikett}</span>
        {p.teller && n > 0 && (
          <span className="pf-cnt" aria-label={TELLER_TEKST[p.teller](n)}>{n}</span>
        )}
      </Link>
    );
  };

  return (
    <div className="pf-side">
      {menyApen && <div className="sidebar-backdrop" onClick={() => setMenyApen(false)} />}
      <nav className={`pf-meny${menyApen ? " apen" : ""}`} aria-label="Plattformmeny">
        <Link href="/plattform" className="pf-merke" onClick={() => setMenyApen(false)}>
          <span className="pf-mark" aria-hidden>
            {bruker ? initialer(bruker.name) : "PA"}
          </span>
          <span>
            {/* «TEST» henges på navnet med CSS når layouten setter data-miljo="test". */}
            <span className="pf-merke-navn">
              Drift<span className="iq">IQ</span>
            </span>
            <span className="pf-tag">PLATTFORM</span>
          </span>
        </Link>

        {MENY.map((g, i) => (
          <div key={g.gruppe ?? i} className="pf-meny-blokk">
            {g.gruppe && <div className="pf-meny-gruppe">{g.gruppe}</div>}
            {g.punkter.map(lenke)}
          </div>
        ))}

        <div className="pf-meny-fot">
          {lenke(INNSTILLINGER)}
          <a className="pf-lenke pf-lenke-dempet" href={appLenke}>
            <ArrowLeft size={17} strokeWidth={1.9} aria-hidden />
            <span>Til kundeappen</span>
          </a>
          {/* Temaveksleren står også her — panelet er en egen flate, og man skal ikke måtte
              innom kunde-appen for å bytte. */}
          <Temaknapp />
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
