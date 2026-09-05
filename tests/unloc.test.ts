/**
 * Unloc — digitale nøkler til leverandører. Ingen v1-forgjenger (v1 hadde en integrasjon,
 * men koden er borte med v1-repoet; dette er bygget fra Unloc API v2-dokumentasjonen).
 *
 * Tyngdepunktet: (1) hvitelista over lovlige kall er lukket — DriftIQ rører aldri låser,
 * adgangsgrupper eller andres nøkler; (2) client secret ligger aldri i klartekst og lekker
 * aldri ut av status-svaret; (3) en utdeling bokføres med utdeler (navn OG id), lås-navn
 * som snapshot og hendelse i loggen, og en tilbakekalling gjør det samme uten å slette
 * raden; (4) sletting av leverandør nektes mens nøkler er aktive; (5) org A ser aldri
 * org Bs kobling eller nøkler.
 *
 * Nettet er stubbet (`fetch`) — testene går aldri mot api.unloc.app.
 */

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool, type PoolClient } from "pg";
import { lukkPooler, withOrg } from "../src/db/client";
import type { ApiFeil } from "../src/lib/api";
import type { Aktor } from "../src/lib/aktor";
import { slettLeverandor } from "../src/lib/leverandorer";
import { TILLATTE_KALL, erTillatt, glemTokens, tilE164, unlocKall, visTelefon } from "../src/lib/unloc";
import {
  antallAktiveNokler,
  delUtNokkel,
  hentKobling,
  hentLaaser,
  hentNoklerForLeverandor,
  kobleFra,
  kobleTil,
  tilbakekall,
} from "../src/lib/unlockobling";

let eierPool: Pool;
let eier: PoolClient;
const ryddOrg: string[] = [];
const kari: Aktor = { navn: "Kari Styreleder", brukerId: null };
const ola: Aktor = { navn: "Ola Nestleder", brukerId: null };

const PROSJEKT = "11111111-1111-4111-8111-111111111111";
const LAAS_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LAAS_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CRED = { clientId: "b0bf99dd-f79e-4571-b94b-09f3dd80f8f9", clientSecret: "hemmelig-secret-1234" };

beforeAll(async () => {
  eierPool = new Pool({ connectionString: process.env.DATABASE_URL! });
  eier = await eierPool.connect();
  process.env.FIKEN_TOKEN_KEY ??= "ab".repeat(32);
});

afterAll(async () => {
  eier.release();
  await eierPool.end();
  await lukkPooler();
});

beforeEach(() => {
  vi.unstubAllGlobals();
  glemTokens();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  for (const id of ryddOrg.splice(0)) {
    await eier.query("DELETE FROM vendor_unloc_keys WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM unloc_settings WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM audit_events WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM vendor_contacts WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM vendors WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM organizations WHERE id = $1", [id]);
  }
});

async function oppsett() {
  const orgId = `unl-${randomUUID()}`;
  await eier.query("INSERT INTO organizations (id, name, slug, active) VALUES ($1,$2,$3,true)", [orgId, "Unloclaget", orgId]);
  ryddOrg.push(orgId);
  const vendorId = randomUUID();
  await eier.query("INSERT INTO vendors (id, org_id, name, active) VALUES ($1,$2,'Heis AS',true)", [vendorId, orgId]);
  return { orgId, vendorId };
}

const i = <T>(orgId: string, fn: Parameters<typeof withOrg<T>>[1]) => withOrg(orgId, fn);

async function feilFra(fn: () => Promise<unknown>): Promise<ApiFeil> {
  try {
    await fn();
  } catch (e) {
    return e as ApiFeil;
  }
  throw new Error("Forventet en feil, men kallet gikk gjennom");
}

type Stubbvalg = {
  /** Prosjekter credentials når (alle med project.admin). */
  prosjekter?: string[];
  /** Nøkler Unloc svarer med på GET /keys — tilstand per nøkkel-id. */
  nokler?: Array<{ id: string; lockId: string; appUserId: string; state: string; end?: string | null; created?: string }>;
  /** Hva jobben svarer: ferdig med id, feilet, eller aldri ferdig. */
  jobb?: "ok" | "feilet" | "henger";
  /** Svar 404 på DELETE. */
  slettBorte?: boolean;
};

/** Stubber Unloc: token, ressursoppdagelse, prosjekt, låser, nøkler, jobb og tilbakekalling. */
function stubbUnloc(valg: Stubbvalg = {}) {
  const kall: Array<{ metode: string; sti: string; kropp: unknown }> = [];
  const prosjekter = valg.prosjekter ?? [PROSJEKT];
  const nokler = valg.nokler ?? [];
  let opprettet = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = new URL(String(url));
      const metode = init?.method ?? "GET";
      const kropp = init?.body ? JSON.parse(String(init.body)) : undefined;
      kall.push({ metode, sti: `${u.pathname}${u.search}`, kropp });

      if (u.pathname === "/v2/auth/token/") {
        if (kropp.client_secret !== CRED.clientSecret) return Response.json({ error: "invalid_client" }, { status: 401 });
        return Response.json({ access_token: `tok-${kropp.project_id}`, expires_in: 3600, project_id: kropp.project_id });
      }
      if (u.pathname === "/v2/auth/resources-discovery/") {
        if (kropp.client_secret !== CRED.clientSecret) return Response.json({ error: "invalid_client" }, { status: 401 });
        return Response.json({ resources: { projects: prosjekter.map((p) => ({ projectId: p, scope: "project.admin" })), organizations: [] } });
      }
      if (!init?.headers || !("Authorization" in (init.headers as Record<string, string>))) {
        return Response.json({ error: "JsonWebTokenError" }, { status: 401 });
      }
      const m = /^\/v2\/projects\/([^/]+)(?:\/(.*))?$/.exec(u.pathname);
      if (!m) return new Response("not found", { status: 404 });
      const [, pid, rest = ""] = m;
      if (rest === "") return Response.json({ project: { id: pid, name: `Sameiet ${pid!.slice(0, 4)}`, organizationId: "org-1" } });
      if (rest === "locks") {
        return Response.json({ locks: [
          { id: LAAS_B, name: "Bakdør", vendor: "danalock" },
          { id: LAAS_A, name: "Hovedinngang", vendor: "danalock", address: { floor: "1. etg" } },
        ] });
      }
      if (rest === "keys" && metode === "GET") {
        const lockId = u.searchParams.get("lockId");
        const appUserId = u.searchParams.get("appUserId");
        const treff = nokler.filter((k) => (!lockId || k.lockId === lockId) && (!appUserId || k.appUserId === appUserId));
        return Response.json({ keys: treff.map((k) => ({ id: k.id, lockId: k.lockId, appUser: { id: k.appUserId }, state: k.state, end: k.end ?? null, created: k.created ?? new Date().toISOString() })) });
      }
      if (rest === "keys" && metode === "POST") {
        opprettet++;
        const jobId = `job-${opprettet}`;
        const nyId = `key-${opprettet}`;
        // Jobben «lager» nøkkelen — legg den i lista så oppslag etterpå finner den.
        const k = kropp.keys[0];
        nokler.push({ id: nyId, lockId: k.lockId, appUserId: k.appUserId, state: k.start ? "scheduled" : "active", end: k.end ?? null, created: new Date().toISOString() });
        return Response.json({ jobRef: { id: jobId, jobType: "createKeys", jobStatusUrl: "" } }, { status: 202 });
      }
      const jobb = /^jobs\/(.+)$/.exec(rest);
      if (jobb) {
        const n = Number(jobb[1]!.replace("job-", ""));
        const id = `key-${n}`;
        if (valg.jobb === "feilet") return Response.json({ job: { id: jobb[1], type: "createKeys", status: "failedJob", created: "", failureReason: "Vendor rejected the key" } });
        if (valg.jobb === "henger") return Response.json({ job: { id: jobb[1], type: "createKeys", status: "inProgress", created: "" } });
        return Response.json({ job: { id: jobb[1], type: "createKeys", status: "succeeded", created: "", resultData: { createdKeys: [{ id }], failedKeys: [] } } });
      }
      const en = /^keys\/(.+)$/.exec(rest);
      if (en && metode === "GET") {
        const k = nokler.find((x) => x.id === en[1]);
        return k
          ? Response.json({ key: { id: k.id, lockId: k.lockId, appUser: { id: k.appUserId }, state: k.state, end: k.end ?? null } })
          : Response.json({ title: "Key not found" }, { status: 404 });
      }
      if (en && metode === "DELETE") {
        if (valg.slettBorte) return Response.json({ title: "Key not found", detail: "no such key" }, { status: 404 });
        const k = nokler.find((x) => x.id === en[1]);
        if (k) k.state = "revoked";
        return Response.json({ key: { id: en[1], state: "revoked" } });
      }
      return new Response("not found", { status: 404 });
    }),
  );
  return { kall, nokler };
}

describe("adapteret", () => {
  it("hvitelista: bare token, prosjekt, låser, nøkler og jobbstatus — ingen låser eller brukere endres", () => {
    expect(TILLATTE_KALL.map((k) => `${k.metode} ${k.hva}`).length).toBe(9);
    expect(erTillatt("GET", `/v2/projects/${PROSJEKT}/locks?limit=500`)).toBe(true);
    expect(erTillatt("POST", `/v2/projects/${PROSJEKT}/keys`)).toBe(true);
    expect(erTillatt("DELETE", `/v2/projects/${PROSJEKT}/keys/${LAAS_A}`)).toBe(true);
    // Det som IKKE skal kunne skje fra DriftIQ:
    expect(erTillatt("POST", `/v2/projects/${PROSJEKT}/locks/${LAAS_A}`)).toBe(false);
    expect(erTillatt("DELETE", `/v2/projects/${PROSJEKT}/managed-users/x`)).toBe(false);
    expect(erTillatt("POST", `/v2/projects/${PROSJEKT}/access-groups`)).toBe(false);
    expect(erTillatt("DELETE", `/v2/projects/${PROSJEKT}/keys`)).toBe(false); // «Revoke Keys» i bulk
    expect(erTillatt("POST", `/v2/organization/x/projects`)).toBe(false);
  });

  it("kaster før nettet ved kall utenfor lista", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    await expect(unlocKall("t", "GET", `/v2/projects/${PROSJEKT}/managed-users`)).rejects.toThrow(/hvitelista/);
    expect(f).not.toHaveBeenCalled();
  });

  it("telefonnummer: norsk åttesifret får +47, E.164 beholdes, søppel avvises", () => {
    expect(tilE164("912 34 567")).toBe("+4791234567");
    expect(tilE164("+47 912 34 567")).toBe("+4791234567");
    expect(tilE164("0047 91234567")).toBe("+4791234567");
    expect(tilE164("4791234567")).toBe("+4791234567");
    expect(tilE164("+45 12 34 56 78")).toBe("+4512345678");
    expect(tilE164("12345")).toBeNull();
    expect(tilE164("abc")).toBeNull();
    expect(visTelefon("+4791234567")).toBe("+47 912 34 567");
    expect(visTelefon("+4512345678")).toBe("+4512345678");
  });
});

describe("koblingen", () => {
  it("verifiserer credentials mot Unloc, velger det ene prosjektet og lagrer hemmeligheten kryptert", async () => {
    const { orgId } = await oppsett();
    stubbUnloc();
    const status = await i(orgId, (db) => kobleTil(db, orgId, kari, { ...CRED, projectId: null }));
    expect(status.kobling?.projectId).toBe(PROSJEKT);
    expect(status.kobling?.projectName).toMatch(/^Sameiet /);
    expect(status.kobling?.connectedBy).toBe("Kari Styreleder");
    expect(JSON.stringify(status)).not.toContain(CRED.clientSecret);

    const rad = await eier.query("SELECT client_secret_enc FROM unloc_settings WHERE org_id = $1", [orgId]);
    expect(rad.rows[0].client_secret_enc).toMatch(/^v1:/);
    expect(rad.rows[0].client_secret_enc).not.toContain(CRED.clientSecret);

    const logg = await eier.query("SELECT event, module FROM audit_events WHERE org_id = $1", [orgId]);
    expect(logg.rows[0].module).toBe("leverandorer");
    expect(logg.rows[0].event).toMatch(/Koblet digitale nøkler til Unloc-prosjektet/);
  });

  it("avviser feil secret uten å lagre noe", async () => {
    const { orgId } = await oppsett();
    stubbUnloc();
    const e = await feilFra(() => i(orgId, (db) => kobleTil(db, orgId, kari, { ...CRED, clientSecret: "feil-secret-12345", projectId: null })));
    expect(e.status).toBe(400);
    expect(e.message).toMatch(/avviste tilgangen/);
    expect((await eier.query("SELECT 1 FROM unloc_settings WHERE org_id = $1", [orgId])).rowCount).toBe(0);
  });

  it("krever valg når credentials når flere prosjekter — og navngir dem", async () => {
    const { orgId } = await oppsett();
    const P2 = "22222222-2222-4222-8222-222222222222";
    stubbUnloc({ prosjekter: [PROSJEKT, P2] });
    const e = await feilFra(() => i(orgId, (db) => kobleTil(db, orgId, kari, { ...CRED, projectId: null })));
    expect(e.status).toBe(400);
    expect(e.message).toContain(PROSJEKT);
    expect(e.message).toContain("Sameiet 2222");

    const status = await i(orgId, (db) => kobleTil(db, orgId, kari, { ...CRED, projectId: P2 }));
    expect(status.kobling?.projectId).toBe(P2);
  });

  it("frakobling fjerner credentials, beholder nøkkelhistorikken og logger antall aktive", async () => {
    const { orgId, vendorId } = await oppsett();
    stubbUnloc();
    await i(orgId, (db) => kobleTil(db, orgId, kari, { ...CRED, projectId: null }));
    await i(orgId, (db) => delUtNokkel(db, orgId, vendorId, kari, { lockId: LAAS_A, phone: "912 34 567", holderName: "Ola Montør" }));
    await i(orgId, (db) => kobleFra(db, orgId, ola));
    expect((await i(orgId, (db) => hentKobling(db, orgId))).kobling).toBeNull();
    expect((await eier.query("SELECT 1 FROM vendor_unloc_keys WHERE org_id = $1", [orgId])).rowCount).toBe(1);
    const logg = await eier.query("SELECT event FROM audit_events WHERE org_id = $1 ORDER BY occurred_at DESC LIMIT 1", [orgId]);
    expect(logg.rows[0].event).toMatch(/Koblet fra .* 1 utdelt nøkkel sto fortsatt aktiv/);
  });

  it("låsene hentes live og sorteres på navn", async () => {
    const { orgId } = await oppsett();
    stubbUnloc();
    await i(orgId, (db) => kobleTil(db, orgId, kari, { ...CRED, projectId: null }));
    const laaser = await i(orgId, (db) => hentLaaser(db, orgId));
    expect(laaser.map((l) => l.name)).toEqual(["Bakdør", "Hovedinngang"]);
    expect(laaser[1]?.floor).toBe("1. etg");
  });
});

describe("nøkler", () => {
  async function koblet() {
    const o = await oppsett();
    const stubb = stubbUnloc();
    await i(o.orgId, (db) => kobleTil(db, o.orgId, kari, { ...CRED, projectId: null }));
    return { ...o, ...stubb };
  }

  it("utdeling: nøkkel i Unloc, rad med utdeler og låsnavn-snapshot, hendelse i loggen", async () => {
    const { orgId, vendorId, kall } = await koblet();
    const n = await i(orgId, (db) =>
      delUtNokkel(db, orgId, vendorId, kari, { lockId: LAAS_A, phone: "912 34 567", holderName: "Ola Montør", endAt: "2030-01-01T10:00:00.000Z", note: "Heisservice" }),
    );
    expect(n.unlocKeyId).toBe("key-1");
    expect(n.lockName).toBe("Hovedinngang");
    expect(n.phone).toBe("+4791234567");
    expect(n.state).toBe("active");
    expect(n.issuedBy).toBe("Kari Styreleder");
    expect(n.endAt?.toISOString()).toBe("2030-01-01T10:00:00.000Z");

    const post = kall.find((k) => k.metode === "POST" && k.sti.endsWith("/keys"))!;
    // `start` utelates (= nå): Unloc avviser `null` med «must be of type string», tross dokumentasjonen.
    expect(post.kropp).toEqual({
      keys: [{
        lockId: LAAS_A, appUserId: "+4791234567", end: "2030-01-01T10:00:00.000Z",
        metadata: { driftiq_vendor: "Heis AS", driftiq_vendor_id: vendorId, driftiq_issued_by: "Kari Styreleder" },
      }],
    });

    const logg = await eier.query("SELECT event, entity, entity_id FROM audit_events WHERE org_id = $1 ORDER BY occurred_at DESC LIMIT 1", [orgId]);
    expect(logg.rows[0].entity).toBe("unloc_nokkel");
    expect(logg.rows[0].entity_id).toBe(n.id);
    expect(logg.rows[0].event).toMatch(/Delte ut digital nøkkel til «Hovedinngang» for Ola Montør \(Heis AS\), gyldig til 2030-01-01 — Heisservice/);
    expect(await i(orgId, (db) => antallAktiveNokler(db, orgId, vendorId))).toBe(1);
  });

  it("avviser ugyldig nummer, utløp før start og ukjent lås — uten å ringe Unloc for nøkkelen", async () => {
    const { orgId, vendorId, kall } = await koblet();
    const e1 = await feilFra(() => i(orgId, (db) => delUtNokkel(db, orgId, vendorId, kari, { lockId: LAAS_A, phone: "12345678901234567", holderName: "X" })));
    expect(e1.message).toMatch(/Mobilnummeret/);
    const e2 = await feilFra(() => i(orgId, (db) => delUtNokkel(db, orgId, vendorId, kari, { lockId: LAAS_A, phone: "91234567", holderName: "X", startAt: "2030-01-02T00:00:00Z", endAt: "2030-01-01T00:00:00Z" })));
    expect(e2.message).toMatch(/etter starttidspunktet/);
    const e3 = await feilFra(() => i(orgId, (db) => delUtNokkel(db, orgId, vendorId, kari, { lockId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", phone: "91234567", holderName: "X" })));
    expect(e3.message).toMatch(/Låsen finnes ikke/);
    expect(kall.some((k) => k.metode === "POST" && k.sti.endsWith("/keys"))).toBe(false);
  });

  it("feilet jobb hos Unloc gir 503 med grunnen (aldri 502 — Cloudflare bytter den ut), og ingen rad", async () => {
    const { orgId, vendorId } = await oppsett();
    stubbUnloc({ jobb: "feilet" });
    await i(orgId, (db) => kobleTil(db, orgId, kari, { ...CRED, projectId: null }));
    const e = await feilFra(() => i(orgId, (db) => delUtNokkel(db, orgId, vendorId, kari, { lockId: LAAS_A, phone: "91234567", holderName: "X" })));
    expect(e.status).toBe(503);
    expect(e.message).toMatch(/Vendor rejected the key/);
    expect((await eier.query("SELECT 1 FROM vendor_unloc_keys WHERE org_id = $1", [orgId])).rowCount).toBe(0);
  });

  it("tilbakekalling: Unloc først, så raden — som blir stående med hvem som kalte tilbake", async () => {
    const { orgId, vendorId, kall } = await koblet();
    const n = await i(orgId, (db) => delUtNokkel(db, orgId, vendorId, kari, { lockId: LAAS_A, phone: "91234567", holderName: "Ola Montør" }));
    await i(orgId, (db) => tilbakekall(db, orgId, vendorId, n.id, ola));
    expect(kall.some((k) => k.metode === "DELETE" && k.sti.endsWith(`/keys/${n.unlocKeyId}`))).toBe(true);

    const r = await i(orgId, (db) => hentNoklerForLeverandor(db, orgId, vendorId, { frisk: false }));
    expect(r.nokler).toHaveLength(1);
    expect(r.nokler[0]?.state).toBe("revoked");
    expect(r.nokler[0]?.revokedBy).toBe("Ola Nestleder");
    expect(r.nokler[0]?.revokedAt).not.toBeNull();
    expect(await i(orgId, (db) => antallAktiveNokler(db, orgId, vendorId))).toBe(0);

    const e = await feilFra(() => i(orgId, (db) => tilbakekall(db, orgId, vendorId, n.id, ola)));
    expect(e.message).toMatch(/allerede kalt tilbake/);
    const logg = await eier.query("SELECT event FROM audit_events WHERE org_id = $1 AND event LIKE 'Kalte tilbake%'", [orgId]);
    expect(logg.rows[0].event).toMatch(/Kalte tilbake digital nøkkel til «Hovedinngang» fra Ola Montør \(Heis AS\)/);
  });

  it("400 fra Unloc (avvist forespørsel) blir 400 hos oss med Unlocs feltfeil i meldingen", async () => {
    const { orgId, vendorId } = await koblet();
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = new URL(String(url));
      if (u.pathname.endsWith("/token/")) return Response.json({ access_token: "t", expires_in: 3600 });
      if (u.pathname.endsWith("/locks")) return Response.json({ locks: [{ id: LAAS_A, name: "Hovedinngang" }] });
      if (init?.method === "POST") {
        return Response.json({ title: "Validation Error", detail: "Your request parameters did not pass validation", invalidParams: [{ name: "keys.0.appUserId", reason: "must be E.164" }] }, { status: 400 });
      }
      return new Response("not found", { status: 404 });
    }));
    glemTokens();
    const e = await feilFra(() => i(orgId, (db) => delUtNokkel(db, orgId, vendorId, kari, { lockId: LAAS_A, phone: "91234567", holderName: "X" })));
    expect(e.status).toBe(400);
    expect(e.message).toMatch(/did not pass validation \(keys.0.appUserId: must be E.164\)/);
  });

  it("404 fra Unloc ved tilbakekalling = allerede borte der — raden oppdateres likevel", async () => {
    const { orgId, vendorId } = await oppsett();
    stubbUnloc({ slettBorte: true });
    await i(orgId, (db) => kobleTil(db, orgId, kari, { ...CRED, projectId: null }));
    const n = await i(orgId, (db) => delUtNokkel(db, orgId, vendorId, kari, { lockId: LAAS_A, phone: "91234567", holderName: "X" }));
    await i(orgId, (db) => tilbakekall(db, orgId, vendorId, n.id, ola));
    expect(await i(orgId, (db) => antallAktiveNokler(db, orgId, vendorId))).toBe(0);
  });

  it("lista frisker opp tilstanden fra Unloc; nøkler som er borte der speiles som tilbakekalt", async () => {
    const { orgId, vendorId, nokler } = await koblet();
    const a = await i(orgId, (db) => delUtNokkel(db, orgId, vendorId, kari, { lockId: LAAS_A, phone: "91234567", holderName: "A" }));
    const b = await i(orgId, (db) => delUtNokkel(db, orgId, vendorId, kari, { lockId: LAAS_B, phone: "91234567", holderName: "B" }));
    // Utenfor DriftIQ: A utløper, B slettes i Control Center.
    nokler.find((k) => k.id === a.unlocKeyId)!.state = "expired";
    nokler.splice(nokler.findIndex((k) => k.id === b.unlocKeyId), 1);

    const r = await i(orgId, (db) => hentNoklerForLeverandor(db, orgId, vendorId));
    expect(r.koblet).toBe(true);
    expect(r.feil).toBeNull();
    const tilstand = Object.fromEntries(r.nokler.map((n) => [n.holderName, n.state]));
    expect(tilstand).toEqual({ A: "expired", B: "revoked" });
    expect(r.nokler.find((n) => n.holderName === "B")?.revokedBy).toMatch(/utenfor DriftIQ/);
    expect(await i(orgId, (db) => antallAktiveNokler(db, orgId, vendorId))).toBe(0);
  });

  it("svikter Unloc ved oppfrisking, kommer lista likevel — med feil satt og sist kjente tilstand", async () => {
    const { orgId, vendorId } = await koblet();
    await i(orgId, (db) => delUtNokkel(db, orgId, vendorId, kari, { lockId: LAAS_A, phone: "91234567", holderName: "A" }));
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nede", { status: 503 })));
    glemTokens();
    const r = await i(orgId, (db) => hentNoklerForLeverandor(db, orgId, vendorId));
    expect(r.feil).toMatch(/503|nede/);
    expect(r.nokler[0]?.state).toBe("active");
    expect((await i(orgId, (db) => hentKobling(db, orgId))).kobling?.lastError).toMatch(/503|nede/);
  });

  it("uten kobling svarer lista koblet=false, og utdeling gir 404", async () => {
    const { orgId, vendorId } = await oppsett();
    const r = await i(orgId, (db) => hentNoklerForLeverandor(db, orgId, vendorId));
    expect(r).toEqual({ koblet: false, feil: null, nokler: [] });
    const e = await feilFra(() => i(orgId, (db) => delUtNokkel(db, orgId, vendorId, kari, { lockId: LAAS_A, phone: "91234567", holderName: "X" })));
    expect(e.status).toBe(404);
  });

  it("leverandør med aktiv nøkkel kan ikke slettes; etter tilbakekalling kan den", async () => {
    const { orgId, vendorId } = await koblet();
    const n = await i(orgId, (db) => delUtNokkel(db, orgId, vendorId, kari, { lockId: LAAS_A, phone: "91234567", holderName: "X" }));
    const e = await feilFra(() => i(orgId, (db) => slettLeverandor(db, orgId, vendorId)));
    expect(e.message).toMatch(/1 aktiv digital nøkkel .* kall den tilbake først/);
    await i(orgId, (db) => tilbakekall(db, orgId, vendorId, n.id, kari));
    await i(orgId, (db) => slettLeverandor(db, orgId, vendorId));
    expect((await eier.query("SELECT 1 FROM vendors WHERE id = $1", [vendorId])).rowCount).toBe(0);
  });
});

describe("tenantisolasjon", () => {
  it("org B ser verken org As kobling, låser eller nøkler", async () => {
    const a = await oppsett();
    const b = await oppsett();
    stubbUnloc();
    await i(a.orgId, (db) => kobleTil(db, a.orgId, kari, { ...CRED, projectId: null }));
    await i(a.orgId, (db) => delUtNokkel(db, a.orgId, a.vendorId, kari, { lockId: LAAS_A, phone: "91234567", holderName: "X" }));

    expect((await i(b.orgId, (db) => hentKobling(db, b.orgId))).kobling).toBeNull();
    expect((await feilFra(() => i(b.orgId, (db) => hentLaaser(db, b.orgId)))).status).toBe(404);
    // B kan ikke lese As leverandør, og heller ikke As nøkler gjennom sin egen leverandør.
    expect((await feilFra(() => i(b.orgId, (db) => hentNoklerForLeverandor(db, b.orgId, a.vendorId)))).status).toBe(404);
    expect((await i(b.orgId, (db) => hentNoklerForLeverandor(db, b.orgId, b.vendorId))).nokler).toEqual([]);
    expect(await i(b.orgId, (db) => antallAktiveNokler(db, b.orgId))).toBe(0);
    expect(await i(a.orgId, (db) => antallAktiveNokler(db, a.orgId))).toBe(1);
  });
});
