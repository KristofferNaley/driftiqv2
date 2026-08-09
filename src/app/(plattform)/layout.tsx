import type { ReactNode } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { OktProvider } from "@/components/OktProvider";
import { withoutRls } from "@/db/client";
import { users } from "@/db/schema/users";
import { auth } from "@/lib/auth";
import { erPlattformadminRolle } from "@/lib/nivaer";

/**
 * Plattformpanelet — DriftIQs egen side.
 *
 * ## Gaten står på SERVEREN, og svarer 404
 *
 * Første utkast lot hvem som helst innlogget nå panelet og møtte dem med «krever
 * plattformadmin-tilgang». API-et avviste alt, så ingen data lakk — men skallet gjorde det:
 * et styremedlem fikk se at panelet finnes, hva menyen heter, og at det er noe som handler
 * om kunder, henvendelser og support. Det er informasjon de ikke skal ha.
 *
 * Derfor `notFound()` og ikke en feilmelding: en 403 bekrefter at ruta finnes. En 404 sier
 * ingenting, og for den som ikke skal være her er det sant nok — siden finnes ikke for dem.
 *
 * Sjekken ligger i LAYOUTEN, ikke i hver side. Legger noen til en ny side under
 * `/plattform` om et år, er den beskyttet uten å ha gjort noe. Det motsatte — å måtte huske
 * en sjekk per side — var nettopp feilen: fire av fem sider hadde ingen.
 *
 * ## Egen rutegruppe, delt origin
 *
 * v1 hadde panelet som egen build på egen port, og det ga reell adskillelse. Her deles
 * origin for å slippe en container til, og kostnaden er kjent: forsvaret ligger i denne
 * gaten og i at hver plattformrute krever `nivaa: "plattformadmin"`. Klientkoden avgjør
 * bare hva som tegnes.
 */
export default async function PlattformLayout({ children }: { children: ReactNode }) {
  const sesjon = await auth.api.getSession({ headers: await headers() });
  if (!sesjon?.user?.id) notFound();

  // Den FERSKE raden, ikke kopien i sesjonen: trekkes plattformtilgangen, skal panelet
  // lukke seg ved neste sidelast — ikke ved neste innlogging.
  const rader = await withoutRls("innlogging", (db) =>
    db.select({ rolle: users.role, aktiv: users.active }).from(users).where(eq(users.id, sesjon.user.id)).limit(1),
  );
  const bruker = rader[0];
  if (!bruker?.aktiv || !erPlattformadminRolle(bruker.rolle)) notFound();

  return <OktProvider versjon="0.1.0">{children}</OktProvider>;
}
