/**
 * Hvem er jeg, og hvilke organisasjoner har jeg tilgang til?
 *
 * Sidemenyen trenger BÅDE medlemskapene og hver orgs modulliste for å vite hva den skal
 * vise. I v1 lå dette i localStorage og var et snapshot per økt — endret noen et medlemskap,
 * så ikke den åpne fanen det før neste sidelast, og symptomet var lesevisning uten
 * forklaring. Her hentes det ved oppstart og etter hvert orgbytte.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { withoutRls } from "@/db/client";
import { organizations } from "@/db/schema/organizations";
import { userOrgMemberships } from "@/db/schema/users";
import { supportAccessLog } from "@/db/schema/platform";
import { erPlattformadminRolle } from "@/lib/nivaer";
import { lesKropp, plattformRute } from "@/lib/api";
import { z } from "zod";
import { users } from "@/db/schema/users";

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

    /**
     * Org-ene plattformadminen har aktivt support-innsyn i.
     *
     * Kunde-appen trenger dette for å kunne SI at du er inne på en support-sesjon. Uten det
     * ser sidemeny og tilgangsnivå ut som om du er et vanlig styremedlem — og da er innsynet
     * usynlig for den som utfører det, som er den verste varianten.
     */
    const supportOrger = erPlattformadminRolle(bruker.role)
      ? (
          await withoutRls("plattformpanel", (d) =>
            d
              .select({ orgId: supportAccessLog.orgId })
              .from(supportAccessLog)
              .where(
                and(
                  eq(supportAccessLog.superadminId, bruker.id),
                  isNull(supportAccessLog.endedAt),
                  sql`${supportAccessLog.expiresAt} > now()`,
                ),
              ),
          )
        ).map((r) => r.orgId)
      : [];

    return {
      /**
       * Domenet plattformpanelet ligger på, når vertene er delt.
       *
       * Kunde-appen trenger det for å kunne lenke TIL panelet fra support-stripa: der er
       * `/plattform` en 404. Kommer herfra og ikke fra en `NEXT_PUBLIC_`-variabel — den
       * bakes inn ved bygg, og et domenebytte ville krevd nytt image.
       */
      adminVert: process.env.VERT_ADMIN ?? null,
      supportOrger,
      id: bruker.id,
      name: bruker.name,
      email: bruker.email,
      phone: bruker.phone,
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

/**
 * Egen profil.
 *
 * **E-post er ikke med.** Den er innloggingsnøkkelen og eies av Better Auth — endres den i
 * `users` uten at Better Auth vet om det, låser brukeren seg ute ved neste innlogging. v1
 * lot feltet endres fordi det ikke fantes noe skille der; her må et bytte gå gjennom Better
 * Auths egen e-postflyt med verifisering, og den er ikke portert ennå.
 *
 * Navnet er derimot fritt: det brukes til visning og til «meldt av»-feltene, ikke til å
 * autentisere noen.
 */
const profilEndring = z.object({
  name: z.string().trim().min(1, "Navn må fylles ut").optional(),
  phone: z.string().trim().nullish(),
});

export const PUT = plattformRute({
  nivaa: "alle",
  handler: async ({ db, bruker, req }) => {
    const data = await lesKropp(req, profilEndring);
    const felter: { name?: string; phone?: string | null } = {};
    if (data.name !== undefined) felter.name = data.name;
    if (data.phone !== undefined) felter.phone = data.phone ?? null;
    if (Object.keys(felter).length > 0) {
      await db.update(users).set(felter).where(eq(users.id, bruker.id));
    }
    return { ...bruker, ...felter };
  },
});
