import type { Metadata } from "next";
import type { ReactNode } from "react";
// Selvhostet, bundles av Next. IKKE Google Fonts-CDN: det ville sendt beboernes
// IP-adresser til en tredjepart. Variabel font — én import dekker vekt 200–800.
import "@fontsource-variable/plus-jakarta-sans";
import "./globals.css";

export const metadata: Metadata = {
  title: "DriftIQ",
  description: "Drift og internkontroll for borettslag og sameier",
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
