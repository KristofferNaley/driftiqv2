import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { OktProvider } from "@/components/OktProvider";
import { Webanalyse } from "@/components/Webanalyse";
import { ER_TESTMILJO } from "@/lib/miljo";

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
/**
 * Testmiljøet får egne ikoner med «TEST»-bånd og eget manifestnavn («TEST IQ»), så en
 * installert app på mobilen aldri kan forveksles med prod — hjemskjermen viser bare
 * ikonet. `icons` overstyres HER og ikke i rotlayouten: markedssiden skal forbli statisk,
 * og apple-touch-ikonet leses fra siden man står på når man legger til på hjemskjermen.
 *
 * `headers()` gjør metadataen til et kjøretidsspørsmål: uten den kunne Next ha evaluert
 * den ved bygg, der `VERT_APP` ikke er satt, og test hadde fått prod-ikonene.
 */
export async function generateMetadata(): Promise<Metadata> {
  await headers();
  if (!ER_TESTMILJO) return { manifest: "/manifest.webmanifest" };
  return {
    title: "DriftIQ TEST",
    manifest: "/manifest-test.webmanifest",
    icons: {
      icon: [
        { url: "/favicon.svg", type: "image/svg+xml" },
        { url: "/ikon-192-test.png", type: "image/png", sizes: "192x192" },
      ],
      apple: "/apple-touch-icon-test.png",
    },
  };
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    // `data-miljo` lar CSS-en henge «TEST» på logoen (se .logo-tekst i globals.css) uten at
    // sidemenyen trenger vite noe om miljøet.
    <div data-miljo={ER_TESTMILJO ? "test" : undefined} style={{ display: "contents" }}>
    <OktProvider versjon="1.0.0">
      {/* Hvilke moduler som faktisk brukes, og hvor mye. Egen nettsteds-ID, atskilt fra
          landingssiden — «hvem fant oss» og «hva brukes» er to ulike spørsmål.
          Plattformpanelet har bevisst ingen; se Webanalyse.tsx. */}
      <Webanalyse flate="app" />
      {children}
    </OktProvider>
    </div>
  );
}
