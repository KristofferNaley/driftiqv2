import type { ReactNode } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { OktProvider } from "@/components/OktProvider";
import { VerterProvider } from "./verter";
import { withoutRls } from "@/db/client";
import { users } from "@/db/schema/users";
import { auth } from "@/lib/auth";
import { erPlattformadminRolle } from "@/lib/nivaer";
import { ER_TESTMILJO } from "@/lib/miljo";
import type { Metadata } from "next";

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
 * ## Uinnlogget er et ANNET tilfelle
 *
 * Den som ikke er innlogget i det hele tatt, sendes til `/logg-inn` i stedet. Det lekker
 * ingenting: innloggingssiden serveres på alle verter uansett (`alltidTillatt` i
 * middleware), og siden avslører ikke om det finnes et panel bak. Det som lakk, og som
 * fortsatt stoppes av `notFound()`, er at et INNLOGGET styremedlem fikk se panelets skall.
 *
 * Uten skillet ble en utløpt cookie en blindvei: panelverten sender rot til `/plattform`,
 * som svarte 404, uten noe spor av en vei videre. Traff meg selv 16.08.2026 da panelet
 * flyttet fra `v2-admin` til `test-admin` og cookien ble stående igjen på det gamle navnet.
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
/**
 * Fanen skal si hvor man er: «Plattformadmin», og «Plattformadmin TEST» i testmiljøet, med
 * TEST-ikonene — samme grep som kundeappen (se (app)/layout.tsx). Panelet er ikke en PWA og
 * får ikke noe manifest.
 */
export async function generateMetadata(): Promise<Metadata> {
  await headers();
  if (!ER_TESTMILJO) return { title: "Plattformadmin — DriftIQ" };
  return {
    title: "Plattformadmin TEST",
    icons: {
      icon: [
        { url: "/favicon.svg", type: "image/svg+xml" },
        { url: "/ikon-192-test.png", type: "image/png", sizes: "192x192" },
      ],
      apple: "/apple-touch-icon-test.png",
    },
  };
}

export default async function PlattformLayout({ children }: { children: ReactNode }) {
  const sesjon = await auth.api.getSession({ headers: await headers() });
  // Ingen `?retur=` med stien hit: skjemaet finner selv fram til `/plattform` på panelverten
  // (`standardSti` i logg-inn/skjema.tsx), og en sti i adresselinja er unødvendig støy.
  if (!sesjon?.user?.id) redirect("/logg-inn");

  // Den FERSKE raden, ikke kopien i sesjonen: trekkes plattformtilgangen, skal panelet
  // lukke seg ved neste sidelast — ikke ved neste innlogging.
  const rader = await withoutRls("innlogging", (db) =>
    db.select({ rolle: users.role, aktiv: users.active }).from(users).where(eq(users.id, sesjon.user.id)).limit(1),
  );
  const bruker = rader[0];
  if (!bruker?.aktiv || !erPlattformadminRolle(bruker.rolle)) notFound();

  return (
    <OktProvider versjon="1.0.0">
      <VerterProvider appVert={process.env.VERT_APP ?? null}>{children}</VerterProvider>
    </OktProvider>
  );
}
