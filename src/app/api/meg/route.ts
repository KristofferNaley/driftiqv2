/**
 * Hvem er jeg, og hvilke organisasjoner har jeg tilgang til?
 *
 * Sidemenyen trenger BÅDE medlemskapene og hver orgs modulliste for å vite hva den skal
 * vise. I v1 lå dette i localStorage og var et snapshot per økt — endret noen et medlemskap,
 * så ikke den åpne fanen det før neste sidelast, og symptomet var lesevisning uten
 * forklaring. Her hentes det ved oppstart og etter hvert orgbytte.
 */
import { eq } from "drizzle-orm";
import { withoutRls } from "@/db/client";
import { organizations } from "@/db/schema/organizations";
import { userOrgMemberships } from "@/db/schema/users";
import { plattformRute } from "@/lib/api";

export const GET = plattformRute({
  nivaa: "alle",
  handler: async ({ db, bruker }) => {
    const rader = await withoutRls("innlogging", (d) =>
      d
        .select({ org: organizations, nivaa: userOrgMemberships.role })
        .from(userOrgMemberships)
        .innerJoin(organizations, eq(organizations.id, userOrgMemberships.orgId))
        .where(eq(userOrgMemberships.userId, bruker.id)),
    );
    void db;

    return {
      id: bruker.id,
      name: bruker.name,
      email: bruker.email,
      role: bruker.role,
      organisasjoner: rader
        .filter((r) => r.org.active)
        .map((r) => ({
          id: r.org.id,
          name: r.org.name,
          nivaa: r.nivaa,
          enabledModules: r.org.enabledModules,
        })),
    };
  },
});
