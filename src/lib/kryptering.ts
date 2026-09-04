/**
 * Kryptering av hemmeligheter som må kunne leses igjen — tokens til regnskapssystemet.
 *
 * AES-256-GCM med nøkkel fra `FIKEN_TOKEN_KEY` (64 hex-tegn = 32 byte), koblet gjennom
 * docker-compose.yaml. Formatet er `v1:<iv>:<tag>:<data>` i base64url, så nøkkelrotasjon
 * senere kan kjenne igjen gamle rader. Passord hashes (bcrypt) og skal aldri hit — dette
 * er for det som må dekrypteres for å brukes.
 *
 * Mangler nøkkelen, feiler kryptering HØYT ved første bruk (ikke ved oppstart): appen
 * skal starte uten regnskapskobling, men aldri lagre et token i klartekst.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALG = "aes-256-gcm";

function nokkel(): Buffer {
  const hex = process.env.FIKEN_TOKEN_KEY ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("FIKEN_TOKEN_KEY mangler eller er ikke 64 hex-tegn — regnskapskoblingen kan ikke lagre tokens");
  }
  return Buffer.from(hex, "hex");
}

export const krypteringErKonfigurert = () => /^[0-9a-fA-F]{64}$/.test(process.env.FIKEN_TOKEN_KEY ?? "");

export function krypter(klartekst: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv(ALG, nokkel(), iv);
  const data = Buffer.concat([c.update(klartekst, "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${data.toString("base64url")}`;
}

export function dekrypter(chiffer: string): string {
  const [v, iv, tag, data] = chiffer.split(":");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Ukjent chifferformat");
  const d = createDecipheriv(ALG, nokkel(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
}
