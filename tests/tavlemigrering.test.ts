/**
 * Oppslagstavla — migreringen fra plassering per blokk (`board_placements`) til felt per
 * skjerm (`board_screens.zones`). Ingen v1-forgjenger; bygget for omleggingen 30.09.2026
 * (docs/oppslagstavle.md «Maler og felt»).
 *
 * Tyngdepunktet: at en skjerm viser det SAMME etter migreringen som før — også der den gamle
 * modellen roterte flere blokker i ett felt, gjaldt bare noen skjermer, eller sto på «Ikke
 * vist» — og at migreringen ikke rører en skjerm som allerede har felt.
 */

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { lukkPooler, withOrg } from "../src/db/client";
import { anonymAktor } from "../src/lib/aktor";
import { hentSkjermer, innholdForSkjerm, kobleSkjerm, sjekkKobling, startKobling } from "../src/lib/oppslagstavle";
import { opprettBlokk } from "../src/lib/tavleblokker";
import { MALER, feltI } from "../src/lib/tavlemaler";
import { kjorFeltmigrering } from "../src/lib/tavlemigrering";

const KARI = anonymAktor("Kari");

let eierPool: Pool;
let eier: PoolClient;
const ryddOrg: string[] = [];
const ryddKoder: string[] = [];

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
  for (const kode of ryddKoder.splice(0)) await eier.query("DELETE FROM board_pairings WHERE code = $1", [kode]);
  for (const id of ryddOrg.splice(0)) {
    await eier.query("DELETE FROM board_blocks WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM board_placements WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM board_pairings WHERE screen_id IN (SELECT id FROM board_screens WHERE org_id = $1)", [id]);
    await eier.query("DELETE FROM board_screens WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM audit_events WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM organizations WHERE id = $1", [id]);
  }
});

async function nyOrg(): Promise<string> {
  const id = `migr-${randomUUID()}`;
  await eier.query("INSERT INTO organizations (id, name, slug, active) VALUES ($1,'Migreringslaget',$2,true)", [id, id]);
  ryddOrg.push(id);
  return id;
}

/** En skjerm slik den så ut FØR omleggingen: mal satt, ingen felt. */
async function gammelSkjerm(orgId: string, mal: string, retning: "staende" | "liggende" = "liggende") {
  const k = await startKobling();
  ryddKoder.push(k.kode);
  const skjerm = await withOrg(orgId, (db) => kobleSkjerm(db, orgId, KARI, { kode: k.kode, navn: mal, adresse: null, retning }));
  const svar = await sjekkKobling(k.hemmelighet);
  if (svar.status !== "koblet") throw new Error("ikke koblet");
  await eier.query("UPDATE board_screens SET layout = $2, zones = NULL WHERE id = $1", [skjerm.id, mal]);
  return { id: skjerm.id, token: svar.token };
}

/** En rad i den gamle plasseringstabellen. */
const plasser = (orgId: string, nokkel: string, omrade: string, skjermIder: string[] | null = null) =>
  eier.query(
    "INSERT INTO board_placements (id, org_id, block_key, area, all_screens, screen_ids) VALUES ($1,$2,$3,$4,$5,$6)",
    [randomUUID(), orgId, nokkel, omrade, skjermIder === null, skjermIder ?? []],
  );

const felt = async (orgId: string, skjermId: string) =>
  (await withOrg(orgId, (db) => hentSkjermer(db, orgId))).find((s) => s.id === skjermId)!.soner;

const VAER = { type: "vaer" as const, navn: "Været", konfig: { sted: "Bergen", lat: 60.39, lon: 5.32, visning: "timer" as const } };
const AVGANGER = { type: "avganger" as const, navn: "Buss", konfig: { holdeplasser: [{ id: "NSR:StopPlace:61380", navn: "Danmarks plass" }] } };

describe("fra plassering per blokk til felt per skjerm", () => {
  it("uten lagrede plasseringer gjaldt standarden: oppslag stort, kalender og kontakt ved siden av, tømmedager i stripen", async () => {
    const orgId = await nyOrg();
    const s = await gammelSkjerm(orgId, "l-stor-to");
    expect(await kjorFeltmigrering(orgId)).toBe(1);
    expect(await felt(orgId, s.id)).toEqual({ a: ["oppslag"], b: ["kalender"], c: ["kontakt"], stripe: ["tommedager"] });
  });

  it("flere sidefelt-blokker enn malen har felt: overskuddet roterer i det siste feltet, som før", async () => {
    const orgId = await nyOrg();
    const vaer = await withOrg(orgId, (db) => opprettBlokk(db, orgId, KARI, VAER));
    const avg = await withOrg(orgId, (db) => opprettBlokk(db, orgId, KARI, AVGANGER));
    const to = await gammelSkjerm(orgId, "l-stor-to");
    const tre = await gammelSkjerm(orgId, "l-stor-tre");
    await kjorFeltmigrering(orgId);
    // Rekkefølgen i sidefeltene var kalender, egne blokker (eldste først), kontakt.
    expect(await felt(orgId, to.id)).toEqual({
      a: ["oppslag"],
      b: ["kalender"],
      c: [vaer.nokkel, avg.nokkel, "kontakt"],
      stripe: ["tommedager"],
    });
    expect(await felt(orgId, tre.id)).toEqual({
      a: ["oppslag"],
      b: ["kalender"],
      c: [vaer.nokkel],
      d: [avg.nokkel, "kontakt"],
      stripe: ["tommedager"],
    });
  });

  it("fullskjerm har ingen små felt: sidefeltene roterte i det store", async () => {
    const orgId = await nyOrg();
    const l = await gammelSkjerm(orgId, "l-fullskjerm");
    const s = await gammelSkjerm(orgId, "s-fullskjerm", "staende");
    await kjorFeltmigrering(orgId);
    const ventet = { a: ["oppslag", "kalender", "kontakt"], stripe: ["tommedager"] };
    expect(await felt(orgId, l.id)).toEqual(ventet);
    expect(await felt(orgId, s.id)).toEqual(ventet);
  });

  it("lagrede plasseringer følger med: «Ikke vist», nytt område og utvalg av skjermer", async () => {
    const orgId = await nyOrg();
    const vaer = await withOrg(orgId, (db) => opprettBlokk(db, orgId, KARI, VAER));
    const a = await gammelSkjerm(orgId, "l-stor-to");
    const b = await gammelSkjerm(orgId, "l-stor-to");
    await plasser(orgId, "kontakt", "av");
    await plasser(orgId, "tommedager", "side");
    await plasser(orgId, "kalender", "stripe");
    await plasser(orgId, vaer.nokkel, "hoved", [b.id]);
    expect(await kjorFeltmigrering(orgId)).toBe(2);
    expect(await felt(orgId, a.id)).toEqual({ a: ["oppslag"], b: ["tommedager"], c: [], stripe: ["kalender"] });
    expect(await felt(orgId, b.id)).toEqual({ a: ["oppslag", vaer.nokkel], b: ["tommedager"], c: [], stripe: ["kalender"] });
  });

  it("hver mal: alt som ble vist, vises fortsatt, og bare i felt malen har", async () => {
    const orgId = await nyOrg();
    const vaer = await withOrg(orgId, (db) => opprettBlokk(db, orgId, KARI, VAER));
    const skjermer = [];
    for (const m of MALER) skjermer.push({ m, s: await gammelSkjerm(orgId, m.id, m.retning) });
    expect(await kjorFeltmigrering(orgId)).toBe(MALER.length);
    for (const { m, s } of skjermer) {
      const f = await felt(orgId, s.id);
      expect(Object.keys(f), m.id).toEqual(feltI(m));
      expect(Object.values(f).flat().sort(), m.id).toEqual(["oppslag", "kalender", "kontakt", "tommedager", vaer.nokkel].sort());
      expect(f.a![0], m.id).toBe("oppslag");
      expect(f.stripe, m.id).toEqual(["tommedager"]);
    }
  });

  it("skjermen på veggen får de migrerte feltene", async () => {
    const orgId = await nyOrg();
    const s = await gammelSkjerm(orgId, "l-to-like");
    await plasser(orgId, "kontakt", "stripe");
    await kjorFeltmigrering(orgId);
    const innhold = await innholdForSkjerm(new Request("http://localhost/", { headers: { authorization: `Bearer ${s.token}` } }));
    expect(innhold.skjerm.mal).toBe("l-to-like");
    expect(innhold.skjerm.soner).toEqual({ a: ["oppslag"], b: ["kalender"], stripe: ["kontakt", "tommedager"] });
  });

  it("kjøres den igjen, røres ingenting — heller ikke felt styret har endret etterpå", async () => {
    const orgId = await nyOrg();
    const s = await gammelSkjerm(orgId, "l-stor-to");
    await kjorFeltmigrering(orgId);
    await eier.query("UPDATE board_screens SET zones = $2 WHERE id = $1", [s.id, JSON.stringify({ a: ["kalender"], b: [], c: [], stripe: [] })]);
    await plasser(orgId, "oppslag", "av");
    expect(await kjorFeltmigrering(orgId)).toBe(0);
    expect(await felt(orgId, s.id)).toEqual({ a: ["kalender"], b: [], c: [], stripe: [] });
  });
});
