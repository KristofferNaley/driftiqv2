import type { ReactNode } from "react";
import { OktProvider } from "@/components/OktProvider";

/**
 * Alt under `(app)` krever innlogging. Gruppen er parentesert, så den ikke havner i URL-en:
 * `/parkering`, ikke `/app/parkering`.
 *
 * Selve tilgangen håndheves av API-et ved hvert kall — dette laget avgjør bare hva som
 * TEGNES. En klientsidesjekk er en bekvemmelighet, aldri en sikkerhetsmekanisme.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return <OktProvider versjon="0.1.0">{children}</OktProvider>;
}
