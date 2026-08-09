/**
 * Tofaktor (TOTP) — hele flyten: slå på, bekreft med en ekte kode, logg inn med to trinn.
 *
 * Testen genererer koder med samme TOTP-implementasjon som Better Auth bruker
 * (`@better-auth/utils/otp`), fra hemmeligheten i `totpURI`. Den beviser altså at en
 * authenticator-app ville fungert — ikke bare at endepunktene svarer 200.
 */

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import bcrypt from "bcryptjs";
import { createOTP } from "@better-auth/utils/otp";
import { base32 } from "@better-auth/utils/base32";
import { auth } from "../src/lib/auth";
import { lukkPooler } from "../src/db/client";

const PASSORD = "et-godt-passord-123";

let eierPool: Pool;
let eier: PoolClient;
const rydd: string[] = [];

beforeAll(async () => {
  eierPool = new Pool({ connectionString: process.env.DATABASE_URL! });
  eier = await eierPool.connect();
});

afterAll(async () => {
  eier.release();
  await eierPool.end();
  await lukkPooler();
});

afterEach(async () => {
  for (const id of rydd.splice(0)) {
    await eier.query("DELETE FROM two_factor WHERE user_id = $1", [id]);
    await eier.query("DELETE FROM session WHERE user_id = $1", [id]);
    await eier.query("DELETE FROM account WHERE user_id = $1", [id]);
    await eier.query("DELETE FROM users WHERE id = $1", [id]);
  }
});

async function nyBruker() {
  const id = randomUUID();
  const epost = `2fa-${id}@driftiq.test`;
  await eier.query(
    `INSERT INTO users (id, name, email, role, active, email_verified, created_at, updated_at)
     VALUES ($1, 'Testbruker', $2, 'member', true, true, now(), now())`,
    [id, epost],
  );
  await eier.query(
    `INSERT INTO account (id, user_id, account_id, provider_id, password, created_at, updated_at)
     VALUES ($1, $2, $3, 'credential', $4, now(), now())`,
    [randomUUID(), id, id, await bcrypt.hash(PASSORD, 12)],
  );
  rydd.push(id);
  return { id, epost };
}

/** Logger inn og returnerer cookie-headeren de påfølgende kallene trenger. */
async function loggInn(epost: string): Promise<{ cookie: string; svar: Response }> {
  const svar = await auth.api.signInEmail({
    body: { email: epost, password: PASSORD },
    asResponse: true,
  });
  const satt = svar.headers.getSetCookie?.() ?? [];
  return { cookie: satt.map((c) => c.split(";")[0]).join("; "), svar };
}

/**
 * Hemmeligheten i otpauth-URI-en er base32-kodet — det er slik authenticator-apper vil ha den.
 * `createOTP()` tar derimot den RÅ hemmeligheten, så den må dekodes tilbake først. Uten dette
 * blir hver eneste genererte kode feil, med «Invalid code» som eneste spor.
 */
function hemmelighetFra(totpURI: string): string {
  const kodet = new URL(totpURI).searchParams.get("secret");
  if (!kodet) throw new Error(`Fant ingen secret i totpURI: ${totpURI}`);
  // Better Auth genererer hemmeligheten som en ASCII-streng og base32-koder den inn i URI-en.
  // Dekodingen gir bytes tilbake, som må tolkes som den samme strengen igjen.
  return new TextDecoder().decode(base32.decode(kodet));
}

async function kode(hemmelighet: string): Promise<string> {
  return createOTP(hemmelighet, { digits: 6, period: 30 }).totp();
}

describe("oppsett av tofaktor", () => {
  it("krever en gyldig kode før tofaktor slås på", async () => {
    // `skipVerificationOnEnable: false`. Uten den kunne noen aktivert 2FA med en QR-kode de
    // aldri skannet, og låst seg selv ute ved neste innlogging.
    const { id, epost } = await nyBruker();
    const { cookie } = await loggInn(epost);

    const svar = await auth.api.enableTwoFactor({
      body: { password: PASSORD },
      headers: { cookie },
    });
    expect(svar.totpURI).toContain("otpauth://totp/");
    expect(svar.backupCodes.length).toBeGreaterThan(0);

    // Enda ikke bekreftet — flagget skal stå av.
    const for_ = await eier.query<{ two_factor_enabled: boolean }>(
      "SELECT two_factor_enabled FROM users WHERE id = $1",
      [id],
    );
    expect(for_.rows[0]!.two_factor_enabled).toBe(false);

    await auth.api.verifyTOTP({
      body: { code: await kode(hemmelighetFra(svar.totpURI)) },
      headers: { cookie },
    });

    const etter = await eier.query<{ two_factor_enabled: boolean }>(
      "SELECT two_factor_enabled FROM users WHERE id = $1",
      [id],
    );
    expect(etter.rows[0]!.two_factor_enabled).toBe(true);
  });

  it("avviser feil kode", async () => {
    const { epost } = await nyBruker();
    const { cookie } = await loggInn(epost);
    await auth.api.enableTwoFactor({ body: { password: PASSORD }, headers: { cookie } });

    await expect(
      auth.api.verifyTOTP({ body: { code: "000000" }, headers: { cookie } }),
    ).rejects.toThrow();
  });

  it("krever passord for å slå på tofaktor", async () => {
    // Uten passordsjekken kunne et kapret sesjonstoken alene slått på 2FA med angriperens
    // hemmelighet — og dermed låst den ekte brukeren ute permanent.
    const { epost } = await nyBruker();
    const { cookie } = await loggInn(epost);

    await expect(
      auth.api.enableTwoFactor({ body: { password: "feil-passord" }, headers: { cookie } }),
    ).rejects.toThrow();
  });
});

describe("innlogging med tofaktor", () => {
  async function medTofaktorPa() {
    const bruker = await nyBruker();
    const { cookie } = await loggInn(bruker.epost);
    const oppsett = await auth.api.enableTwoFactor({
      body: { password: PASSORD },
      headers: { cookie },
    });
    const hemmelighet = hemmelighetFra(oppsett.totpURI);
    await auth.api.verifyTOTP({ body: { code: await kode(hemmelighet) }, headers: { cookie } });
    return { ...bruker, hemmelighet, backupCodes: oppsett.backupCodes };
  }

  it("gir ikke full sesjon på passord alene", async () => {
    // Selve poenget: etter at 2FA er på, skal passordet bare ta deg til trinn to.
    const { epost } = await medTofaktorPa();
    const svar = await auth.api.signInEmail({
      body: { email: epost, password: PASSORD },
    });
    expect((svar as { twoFactorRedirect?: boolean }).twoFactorRedirect).toBe(true);
  });

  it("slipper gjennom med riktig TOTP-kode", async () => {
    const { epost, hemmelighet } = await medTofaktorPa();
    const { cookie } = await loggInn(epost);

    const svar = await auth.api.verifyTOTP({
      body: { code: await kode(hemmelighet) },
      headers: { cookie },
    });
    expect(svar.token).toBeTruthy();
  });

  it("slipper gjennom med en backup-kode", async () => {
    // Styremedlemmer i borettslag mister telefoner. Uten backup-koder blir hver mistet
    // telefon en supportsak — og for en orgadmin som er alene i sin org, en låst dør.
    const { epost, backupCodes } = await medTofaktorPa();
    const { cookie } = await loggInn(epost);

    const svar = await auth.api.verifyBackupCode({
      body: { code: backupCodes[0]! },
      headers: { cookie },
    });
    expect(svar.token).toBeTruthy();
  });

  it("forbruker backup-koden slik at den ikke kan gjenbrukes", async () => {
    const { epost, backupCodes } = await medTofaktorPa();

    const forste = await loggInn(epost);
    await auth.api.verifyBackupCode({
      body: { code: backupCodes[0]! },
      headers: { cookie: forste.cookie },
    });

    const andre = await loggInn(epost);
    await expect(
      auth.api.verifyBackupCode({
        body: { code: backupCodes[0]! },
        headers: { cookie: andre.cookie },
      }),
    ).rejects.toThrow();
  });
});
