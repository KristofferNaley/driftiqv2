import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { Temaveksler } from "./temaveksler";
import { MARKED_URL } from "@/lib/urler";

/**
 * Landingssiden. Egen rutegruppe, ingen `OktProvider`.
 *
 * ## Hvorfor dette IKKE er «use client»
 *
 * Resten av appen er klientsider bak innlogging, der SEO er irrelevant. Her er det motsatt:
 * dette er den eneste flaten Google ser. Sidene er derfor serverkomponenter, og bare
 * kontaktskjemaet er en klientøy — da leveres innholdet ferdig i HTML-en, ikke etter at et
 * JS-bundle har lastet.
 *
 * v1 hadde dette som en egen nginx-container med statisk HTML. Å flytte det hit var hele
 * argumentet for Next: én kodebase, samme designtokens og samme logo som appen.
 */

export const metadata: Metadata = {
    // MARKED_URL, ikke BASE_URL: metadata skal peke på markedsdomenet, ikke kunde-appen.
  metadataBase: new URL(MARKED_URL),
  title: "DriftIQ – driftsforvaltning for borettslag og sameier",
  description:
    "Oppgaver, avvik, internkontroll, vedlikeholdsplan og dokumentasjon samlet ett sted. " +
    "Driftshistorikken følger bygget, ikke styret som satt der i fjor.",
  openGraph: {
    title: "DriftIQ – driftsforvaltning for borettslag og sameier",
    description:
      "Alt styret er ansvarlig for, samlet ett sted. Historikken følger bygget, ikke personen.",
    locale: "nb_NO",
    type: "website",
  },
  // `summary_large_image`, ikke `summary`: uten dette blir en deling på LinkedIn en ren
  // tekstlenke. Selve bildet kommer fra `opengraph-image.tsx` i samme mappe.
  twitter: {
    card: "summary_large_image",
    title: "DriftIQ – driftsforvaltning for borettslag og sameier",
    description:
      "Alt styret er ansvarlig for, samlet ett sted. Historikken følger bygget, ikke personen.",
  },
};

export const viewport: Viewport = { themeColor: "#0d1b2a" };

export default function MarkedLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mk">
      {/* Hopp-lenke: en tastaturbruker skal slippe å tabbe gjennom hele menyen for å nå
          skjemaet, som er hele poenget med siden. */}
      <a className="mk-hopp" href="#kontakt">Hopp til kontaktskjemaet</a>

      <header className="mk-topp">
        <Link href="/" className="mk-logo">
          <span className="logo-mark" aria-hidden>IQ</span>
          <span className="mk-ord">Drift<span>IQ</span></span>
        </Link>
        <nav className="mk-nav">
          <a href="#moduler">Hva systemet dekker</a>
          <a href="#kontakt">Bli pilotlag</a>
          <Temaveksler />
          <Link className="mk-knapp-liten" href="/logg-inn">Logg inn</Link>
        </nav>
      </header>

      {children}

      <footer className="mk-fot">
        <div className="mk-fot-inn">
          <span>
            <span className="mk-ord">Drift<span>IQ</span></span> · driftsforvaltning for
            borettslag og sameier
          </span>
          <span className="mk-fot-lenker">
            <Link href="/personvern">Personvern</Link>
            <Link href="/logg-inn">Logg inn</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
