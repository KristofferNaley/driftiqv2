import { and, eq } from "drizzle-orm";
import { orgRute } from "@/lib/api";
import { ikkeFunnet } from "@/lib/api";
import { userOrgMemberships, users } from "@/db/schema/users";
import { sendOppsettEpost } from "@/lib/brukere";

type P = { brukerId: string };

/**
 * Sender oppsett-/tilbakestillingslenken på nytt.
 *
 * Brukeren må være medlem av DENNE org-en — uten den sjekken kunne en kontoadmin utløse
 * e-post til hvilken som helst bruker i hele plattformen ved å gjette en id.
 */
export const POST = orgRute<P>({
  nivaa: "admin",
  handler: async ({ db, orgId, params, etterCommit }) => {
    const rader = await db
      .select({ epost: users.email })
      .from(userOrgMemberships)
      .innerJoin(users, eq(users.id, userOrgMemberships.userId))
      .where(
        and(
          eq(userOrgMemberships.orgId, orgId),
          eq(userOrgMemberships.userId, params.brukerId),
        ),
      )
      .limit(1);
    const rad = rader[0];
    if (!rad) throw ikkeFunnet("Bruker i denne organisasjonen");

    // Også her etter commit: raden finnes fra før, men en utadrettet handling skal aldri
    // skje før transaksjonen den står i faktisk er fullført.
    etterCommit(() => sendOppsettEpost(rad.epost));
    return { sendt: true };
  },
});
