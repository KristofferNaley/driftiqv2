import type { ReactNode } from "react";
import { OktProvider } from "@/components/OktProvider";

/**
 * Plattformpanelet — DriftIQs egen side.
 *
 * ## Egen rutegruppe, ikke en side inne i kunde-appen
 *
 * v1 hadde panelet som en helt egen build på en egen port, og det ga en reell adskillelse:
 * en kompromittert kundesesjon kunne ikke røre admin, fordi de var ulike origins med hvert
 * sitt `localStorage`.
 *
 * Her deler de origin. Det er et bevisst kompromiss for å slippe en container til, og
 * kostnaden skal være kjent: forsvaret ligger nå UTELUKKENDE i at hver eneste
 * plattformrute krever `nivaa: "plattformadmin"` på serveren. Klientsidesjekken under
 * avgjør bare hva som tegnes.
 *
 * Panelet ser bevisst annerledes ut enn kunde-appen. Å ikke vite om man står i DriftIQs
 * panel eller inne hos en kunde er nettopp slik man gjør noe man ikke mente.
 */
export default function PlattformLayout({ children }: { children: ReactNode }) {
  return <OktProvider versjon="0.1.0">{children}</OktProvider>;
}
