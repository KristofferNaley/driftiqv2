/**
 * Better Auths egne endepunkter: /api/auth/sign-in, /sign-out, /session, /jwks m.fl.
 *
 * `/api/auth/jwks` er den v1s FastAPI skal peke på for å validere de samme sesjonene mens
 * moduler fortsatt ligger igjen der. Se kommentaren i ../../../lib/auth.ts.
 */
import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";

export const { GET, POST } = toNextJsHandler(auth.handler);
