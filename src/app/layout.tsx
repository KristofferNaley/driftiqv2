import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
// Selvhostet, bundles av Next. IKKE Google Fonts-CDN: det ville sendt beboernes
// IP-adresser til en tredjepart. Variabel font — én import dekker vekt 200–800.
import "@fontsource-variable/plus-jakarta-sans";
import "./globals.css";

export const metadata: Metadata = {
  title: "DriftIQ",
  description: "Drift og internkontroll for borettslag og sameier",
  // iOS gjør tekst som LIGNER adresser og telefonnumre om til trykkbare lenker — og
  // borettslag heter ting som «Håsteinsgate 9», så kundenavnet i dashbordbanneret ble av
  // og til en kartlenke i v1. Alt slås av: appen lager sine egne lenker der de skal være.
  formatDetection: { telephone: false, address: false, email: false, date: false, url: false },
  /**
   * Favikonet — HER, i rotlayouten, så hver eneste flate har det: appen, panelet,
   * markedssiden og de anonyme QR-sidene. v2 sto UTEN favicon fram til 16.08.2026;
   * `/favicon.ico` svarte 404, og middlewarens allowlist tillot en fil som ikke fantes.
   *
   * SVG-en er den kanoniske logoen fra v1 (kopiert, aldri tegnet på nytt — samme regel
   * som `.logo-mark`). PNG-ene er rastret fra samme form med appens egen font.
   */
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/ikon-192.png", type: "image/png", sizes: "192x192" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0d1b2a",
  // `cover` lar appen tegne bak iPhone-innsnittet i installert (standalone) modus —
  // safe-area-innrykket håndteres i globals.css. Uten denne får appen svarte striper.
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // Temaet settes før hydrering av skriptet under, ellers blinker mørkt innhold i lys
    // modus (eller omvendt) i det første bildet.
    <html lang="nb" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{document.documentElement.dataset.theme=localStorage.getItem('theme')||'dark'}catch(e){}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
