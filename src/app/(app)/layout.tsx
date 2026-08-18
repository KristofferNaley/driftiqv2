import type { Metadata } from "next";
import type { ReactNode } from "react";
import { OktProvider } from "@/components/OktProvider";
import { Webanalyse } from "@/components/Webanalyse";

/**
 * Alt under `(app)` krever innlogging. Gruppen er parentesert, så den ikke havner i URL-en:
 * `/parkering`, ikke `/app/parkering`.
 *
 * Selve tilgangen håndheves av API-et ved hvert kall — dette laget avgjør bare hva som
 * TEGNES. En klientsidesjekk er en bekvemmelighet, aldri en sikkerhetsmekanisme.
 */
/**
 * PWA-manifestet lenkes KUN her: installasjon som app er for kundeflaten. Markedssiden
 * skal være en nettside og panelet et arbeidsverktøy — ingen av dem skal tilby
 * «installer».
 *
 * Manifestet er en STATISK fil i public/, ikke Nexts `app/manifest.ts`-konvensjon — den
 * injiserer lenken globalt, og da pekte hver landingssidevisning på en fil som svarer 404
 * gjennom vertsdelingen. Merk også at fila går GJENNOM middleware (matcheren unntar ikke
 * .webmanifest): på markeds- og panelverten svarer den 404, og det er gaten, ikke en glipp.
 *
 * Ingen service worker med vilje: Chrome/Android krever bare manifest + ikoner for
 * installasjon, og en service worker som cacher appressurser kan servere FORRIGE deploy
 * etter `git pull + --build` — stille versjonsdrift hos kunden. Offline er en egen
 * beslutning, ikke et biprodukt.
 */
export const metadata: Metadata = { manifest: "/manifest.webmanifest" };

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <OktProvider versjon="1.0.0">
      {/* Hvilke moduler som faktisk brukes, og hvor mye. Egen nettsteds-ID, atskilt fra
          landingssiden — «hvem fant oss» og «hva brukes» er to ulike spørsmål.
          Plattformpanelet har bevisst ingen; se Webanalyse.tsx. */}
      <Webanalyse flate="app" />
      {children}
    </OktProvider>
  );
}
