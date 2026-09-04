/**
 * Adresser i OAuth-flyten, bygget fra `Host` + `x-forwarded-proto` — aldri fra `req.url`,
 * som bak Cloudflare-tunnelen er containerens interne adresse (CLAUDE.md «Next-spesifikke
 * feller»). Redirect-URI-en må være tegn for tegn lik den som er registrert hos Fiken.
 */

export function appUrlFra(req: Request): string {
  const vert = req.headers.get("host") ?? "localhost:3008";
  const proto = req.headers.get("x-forwarded-proto") ?? (vert.startsWith("localhost") ? "http" : "https");
  return `${proto}://${vert}`;
}

export const callbackUrl = (req: Request) => `${appUrlFra(req)}/api/okonomi/fiken/callback`;
