/**
 * Lagring av dashbordoppsettet. Reglene og hvitelista bor i `dashbordwidgets.ts`, som er
 * importfri fordi klienten leser den samme lista.
 *
 * Oppsettet ligger på MEDLEMSKAPET, ikke på brukeren: samme person kan sitte i flere lag og
 * vil ha ulik forside i hvert.
 */

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import { userOrgMemberships } from "../db/schema/users";
import { STORRELSER, WIDGETS, lesOppsett, type Widgetvalg } from "./dashbordwidgets";

export const oppsettInn = z.object({
  /** `null` = tilbakestill til standard. Tom liste betyr det samme, se `lesOppsett`. */
  widgets: z
    .array(z.object({ nokkel: z.string(), storrelse: z.enum(STORRELSER) }))
    .nullable(),
});

export async function hentOppsett(
  db: Db,
  orgId: string,
  brukerId: string,
): Promise<Widgetvalg[] | null> {
  const rader = await db
    .select({ oppsett: userOrgMemberships.dashboardLayout })
    .from(userOrgMemberships)
    .where(and(eq(userOrgMemberships.orgId, orgId), eq(userOrgMemberships.userId, brukerId)))
    .limit(1);
  return lesOppsett(rader[0]?.oppsett);
}

export async function settOppsett(
  db: Db,
  orgId: string,
  brukerId: string,
  widgets: Widgetvalg[] | null,
): Promise<Widgetvalg[] | null> {
  // Siler mot hvitelista FØR lagring. Uten det kunne en klient med gammel kode lagre en
  // nøkkel som ikke finnes, og widgeten ville forsvunnet stille ved neste innlasting.
  const rene = (widgets ?? []).filter((w) => WIDGETS[w.nokkel]);
  await db
    .update(userOrgMemberships)
    .set({ dashboardLayout: rene.length > 0 ? JSON.stringify(rene) : null })
    .where(and(eq(userOrgMemberships.orgId, orgId), eq(userOrgMemberships.userId, brukerId)));
  return rene.length > 0 ? rene : null;
}
