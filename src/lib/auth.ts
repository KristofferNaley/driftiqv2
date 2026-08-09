/**
 * Better Auth — autentiseringen i v2. Erstatter v1s `auth.py` + `routers/auth.py`.
 *
 * ## Én brukertabell, ikke to
 *
 * Better Auth vil normalt eie en egen `user`-tabell. Her peker den i stedet på den
 * eksisterende `users`, som allerede bærer `role`, `active`, `orgId` og medlemskapene. To
 * brukertabeller ville betydd at hver skriving måtte speiles, og at «hvem er dette» hadde to
 * svar som kunne drive fra hverandre. Det er den viktigste beslutningen i denne fila.
 *
 * ## Hvorfor bcrypt og ikke Better Auths standard
 *
 * Biblioteket bruker scrypt som standard. Vi overstyrer til bcrypt fordi v1 og v2 skal leve
 * side om side gjennom hele omskrivingen: `account.password` får da nøyaktig samme format som
 * v1s `users.password_hash`, og et passord byttet i det ene systemet virker i det andre.
 * Uten dette måtte migreringen vært et engangshopp med utlogging av alle.
 *
 * ## Hvorfor JWT-plugin med JWKS
 *
 * v1s FastAPI må kunne validere de samme sesjonene mens den fortsatt betjener moduler som
 * ikke er portert. Med JWKS henter FastAPI den offentlige nøkkelen fra
 * `/api/auth/jwks` og verifiserer selv — ingen delt hemmelighet, og ingen rundtur til
 * Node for hver forespørsel. Alternativet, opake sesjonscookies slått opp i `session`-
 * tabellen, ville tvunget FastAPI til å lese Better Auths interne skjema direkte.
 */

import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { jwt, twoFactor } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { authDb } from "../db/client";
import { account, jwks, session, twoFactor as twoFactorTabell, verification } from "../db/schema/auth";
import { users } from "../db/schema/users";
import { Tilgangsfeil, sjekkInnloggingssperrer } from "./tilgang";

function paakrevd(navn: string): string {
  const verdi = process.env[navn];
  if (!verdi) throw new Error(`${navn} er ikke satt — se .env.example`);
  return verdi;
}

export const auth = betterAuth({
  secret: paakrevd("BETTER_AUTH_SECRET"),
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3008",

  database: drizzleAdapter(authDb, {
    provider: "pg",
    // Nøklene her må hete det samme som modellnavnene Better Auth slår opp — altså `users`
    // og ikke `user`, siden `user.modelName` under peker på den eksisterende tabellen.
    // Stemmer de ikke overens, feiler adapteren først ved første innlogging, ikke ved oppstart.
    schema: { users, session, account, verification, jwks, twoFactor: twoFactorTabell },
  }),

  emailAndPassword: {
    enabled: true,
    // Selvbetjent registrering er AV. Brukere opprettes av en orgadmin inne i kunden, og får
    // en velkomst-e-post med engangslenke — aldri et passord i klartekst. Samme modell som v1.
    disableSignUp: true,
    password: {
      // 12 runder, som passlibs bcrypt-standard i v1. Endres dette, blir hashene uleselige
      // for v1 så lenge de to systemene lever side om side.
      hash: async (passord) => bcrypt.hash(passord, 12),
      verify: async ({ hash, password }) => bcrypt.compare(password, hash),
    },
  },

  session: {
    // v1 hadde 8 timers JWT uten fornyelse. Her er sesjonen 7 dager, men fornyes bare når den
    // er brukt siste døgn — en styreleder som logger inn én gang i uka slipper å gjøre det på
    // nytt hver gang, uten at en glemt økt står åpen i månedsvis.
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },

  user: {
    modelName: "users",
    additionalFields: {
      // Leses av tilgangsgatene. `input: false` er ikke pynt: uten den kunne en bruker sendt
      // med `role: "superadmin"` i et profiloppdateringskall og eskalert seg selv.
      role: { type: "string", input: false },
      active: { type: "boolean", input: false },
      phone: { type: "string", required: false },
    },
  },

  databaseHooks: {
    session: {
      create: {
        /**
         * Sperrene fra v1s `/auth/login`. Better Auth kjenner bare passordet — alt annet om
         * hvem som får slippe inn er vårt: deaktivert bruker, deaktivert organisasjon og
         * utløpt abonnement.
         *
         * De kjøres når sesjonen opprettes, altså etter at passordet er verifisert. Samme
         * rekkefølge som v1, og av samme grunn: et 403 «Brukeren er deaktivert» til noen som
         * ikke kan passordet, ville røpet at kontoen finnes.
         */
        before: async (sesjon) => {
          const rad = await authDb
            .select()
            .from(users)
            .where(eq(users.id, sesjon.userId))
            .limit(1);

          const bruker = rad[0];
          if (!bruker?.active) {
            throw new APIError("FORBIDDEN", { message: "Brukeren er deaktivert" });
          }

          try {
            await sjekkInnloggingssperrer(authDb, bruker);
          } catch (e) {
            if (e instanceof Tilgangsfeil) {
              throw new APIError("FORBIDDEN", { message: e.message });
            }
            throw e;
          }

          return { data: sesjon };
        },
      },
    },
  },

  plugins: [
    /**
     * Tofaktor med authenticator-app (TOTP).
     *
     * Dette var opprinnelig et eget prosjekt i v1: egne kolonner, egen to-trinns
     * innloggingsflyt, egne endepunkter for oppsett, backup-koder og admin-nullstilling —
     * anslått til 2–3 dager. Her er det en plugin, fordi Better Auth allerede eier
     * innloggingsflyten.
     *
     * `skipVerificationOnEnable` står bevisst AV: brukeren må taste en gyldig kode før
     * tofaktor slås på. Uten det kan noen aktivere 2FA med en QR-kode de aldri skannet, og
     * låse seg selv ute ved neste innlogging.
     */
    twoFactor({
      issuer: "DriftIQ",
      skipVerificationOnEnable: false,
      totpOptions: {
        digits: 6,
        period: 30,
      },
    }),

    jwt({
      jwt: {
        // Kort levetid: tokenet er en bærer, og v1 kan ikke slå opp om sesjonen er trukket
        // tilbake. 15 minutter gjør vinduet lite nok til at utlogging faktisk biter.
        expirationTime: "15m",
        definePayload: ({ user }) => ({
          sub: user.id,
          email: user.email,
          role: (user as { role?: string }).role,
        }),
      },
    }),
  ],
});

export type Sesjon = typeof auth.$Infer.Session;
