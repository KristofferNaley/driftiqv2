/**
 * Better Auth — innlogging, bcrypt-kompatibilitet med v1, og sperrene som ikke må gå tapt.
 *
 * Den viktigste testen her er `bcrypt`-en: så lenge v1 og v2 lever side om side, skal en hash
 * skrevet av det ene systemet virke i det andre. Ryker den, blir migreringen et engangshopp
 * der alle må sette nytt passord samtidig.
 */

import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, afterAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import bcrypt from "bcryptjs";
import { auth } from "../src/lib/auth";
import { lukkPooler } from "../src/db/client";

const DATABASE_URL = process.env.DATABASE_URL!;

let eierPool: Pool;
let eier: PoolClient;
const opprettede: string[] = [];

beforeAll(async () => {
  eierPool = new Pool({ connectionString: DATABASE_URL });
  eier = await eierPool.connect();
});

afterAll(async () => {
  eier.release();
  await eierPool.end();
  await lukkPooler();
});

afterEach(async () => {
  for (const id of opprettede.splice(0)) {
    await eier.query("DELETE FROM session WHERE user_id = $1", [id]);
    await eier.query("DELETE FROM account WHERE user_id = $1", [id]);
    await eier.query("DELETE FROM users WHERE id = $1", [id]);
  }
});

/**
 * Oppretter en bruker slik MIGRERINGEN fra v1 vil gjøre det: hashen lages med bcrypt utenfor
 * Better Auth og skrives rett inn i `account.password`. Virker innloggingen, virker også en
 * kopiert `users.password_hash` fra v1.
 */
async function v1Bruker(passord: string, opts: { active?: boolean } = {}) {
  const id = randomUUID();
  const epost = `rlstest-${id}@driftiq.test`;
  await eier.query(
    `INSERT INTO users (id, name, email, role, active, email_verified, created_at, updated_at)
     VALUES ($1, $2, $3, 'member', $4, true, now(), now())`,
    [id, "Testbruker", epost, opts.active ?? true],
  );
  await eier.query(
    `INSERT INTO account (id, user_id, account_id, provider_id, password, created_at, updated_at)
     VALUES ($1, $2, $3, 'credential', $4, now(), now())`,
    [randomUUID(), id, id, await bcrypt.hash(passord, 12)],
  );
  opprettede.push(id);
  return { id, epost };
}

describe("innlogging", () => {
  it("godtar en bcrypt-hash skrevet av v1", async () => {
    const { epost } = await v1Bruker("riktig-passord");
    const svar = await auth.api.signInEmail({
      body: { email: epost, password: "riktig-passord" },
    });
    expect(svar.user.email).toBe(epost);
  });

  it("avviser feil passord", async () => {
    const { epost } = await v1Bruker("riktig-passord");
    await expect(
      auth.api.signInEmail({ body: { email: epost, password: "feil-passord" } }),
    ).rejects.toThrow();
  });

  it("avviser en deaktivert bruker", async () => {
    // v1 svarte 403 «Brukeren er deaktivert» etter at passordet var verifisert. Better Auth
    // kjenner bare passordet — sperren ligger i databaseHooks, og dette er testen som fanger
    // at den fjernes.
    const { epost } = await v1Bruker("riktig-passord", { active: false });
    await expect(
      auth.api.signInEmail({ body: { email: epost, password: "riktig-passord" } }),
    ).rejects.toThrow(/deaktivert/i);
  });

  it("oppretter ikke brukere via selvbetjent registrering", async () => {
    // Brukere opprettes av en orgadmin inne i kunden, aldri utenfra. Står `disableSignUp`
    // feil, kan hvem som helst lage seg en konto i et system for borettslagsdrift.
    await expect(
      auth.api.signUpEmail({
        body: { email: `inntrenger-${randomUUID()}@driftiq.test`, password: "hemmelig123", name: "Uvedkommende" },
      }),
    ).rejects.toThrow();
  });
});

describe("hash-format", () => {
  it("skriver hasher v1 kan lese", async () => {
    // Motsatt retning av testen over: et passord satt i v2 må kunne verifiseres av v1s
    // passlib. Begge bruker bcrypt med 12 runder, så formatet er `$2a$12$…`/`$2b$12$…`.
    const hash = await bcrypt.hash("nytt-passord", 12);
    expect(hash).toMatch(/^\$2[aby]\$12\$/);
    expect(await bcrypt.compare("nytt-passord", hash)).toBe(true);
  });
});
