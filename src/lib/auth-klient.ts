/**
 * Better Auths klientside. Eneste sted innlogging og utlogging skjer fra nettleseren.
 *
 * Tofaktor-pluginen må speiles her for at `signIn.email` skal kunne svare med
 * `twoFactorRedirect` i stedet for en ferdig sesjon — se lib/auth.ts.
 */
"use client";

import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";

export const authKlient = createAuthClient({
  plugins: [twoFactorClient()],
});

export const { signIn, signOut, useSession } = authKlient;
