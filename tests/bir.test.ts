/**
 * BIR — tømmedager til oppslagstavla. Ingen v1-forgjenger; bygget fra bir.no slik nettsiden
 * så ut 29.09.2026 (docs/bir.md), med et ekte utsnitt av tømmekalenderen som fixture.
 *
 * Tyngdepunktet er tolkningen (skraping — det som ryker først) og at en feilende henting
 * aldri tømmer tavla: gamle datoer står, feilen noteres og overlever transaksjonen.
 */

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool, type PoolClient } from "pg";
import { lukkPooler, withOrg } from "../src/db/client";
import { anonymAktor } from "../src/lib/aktor";
import { BirFeil, TILLATTE_KALL, tolkKalender, tolkSok } from "../src/lib/bir";
import { hentBirStatus, kobleBir, kobleFraBir, synkBir, tommedagerForSkjerm } from "../src/lib/birkobling";
import { osloIDag } from "../src/lib/oppslagstavleregler";

const KARI = anonymAktor("Kari");
const FIXTURE = readFileSync(path.join(process.cwd(), "tests", "fixtures", "bir-toemmekalender.html"), "utf8");
const HASTEIN = {
  id: "180a56df-d764-4251-aef6-ab78e1c1486e",
  navn: "Borettslaget Håsteinsgate 9",
  eiendom: "4601.153.217.0.2",
};

let eierPool: Pool;
let eier: PoolClient;
const ryddOrg: string[] = [];

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
  vi.unstubAllGlobals();
  for (const id of ryddOrg.splice(0)) {
    await eier.query("DELETE FROM bir_pickups WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM bir_settings WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM audit_events WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM organizations WHERE id = $1", [id]);
  }
});

async function nyOrg(): Promise<string> {
  const id = `bir-${randomUUID()}`;
  await eier.query("INSERT INTO organizations (id, name, slug, active) VALUES ($1,$2,$3,true)", [id, "BIR-laget", id]);
  ryddOrg.push(id);
  return id;
}

/** BIR på «nettet»: kalenderen som gitt HTML, eller en feil. Alt annet er en testfeil. */
function birSvarer(kalender: string | Error) {
  const f = vi.fn(async (url: string | URL) => {
    const u = new URL(String(url));
    if (u.pathname !== "/adressesoek/toemmekalender/") throw new Error(`Uventet kall: ${u}`);
    if (kalender instanceof Error) throw kalender;
    return new Response(kalender, { status: 200 });
  });
  vi.stubGlobal("fetch", f);
  return f;
}

/** En kalender med én måned, så testene ikke avhenger av at fixturens datoer er framtidige. */
function kalender(maaned: string, rader: Array<[string, string[]]>) {
  return `<div class="month-container"><h2 class="month-title"> ${maaned} </h2>${rader
    .map(
      ([ikon, datoer]) =>
        `<div class="category-row"><div class="icon"><img src="/css/assets/trashicons/${ikon}.svg" /></div>${datoer
          .map((d) => `<div class="date-item"><div class="date-item-day">x</div><div class="date-item-date">${d}</div></div>`)
          .join("")}</div>`,
    )
    .join("")}</div>`;
}

describe("tolkning", () => {
  it("leser den ekte kalenderen: fraksjon fra ikonet, år og måned fra overskriften", () => {
    const d = tolkKalender(FIXTURE);
    expect(d).toContainEqual({ fraksjon: "papir", dato: "2026-09-30" });
    expect(d).toContainEqual({ fraksjon: "rest", dato: "2026-10-05" });
    expect(d).toContainEqual({ fraksjon: "papir", dato: "2026-11-25" });
    // Forklaringen øverst (alle fem ikonene) er ikke tømmedager.
    expect(new Set(d.map((x) => x.fraksjon))).toEqual(new Set(["papir", "rest"]));
    expect(d.filter((x) => x.fraksjon === "rest")).toHaveLength(4 + 4 + 5);
  });

  it("en endret nettside gir en feil, ikke en tom liste", () => {
    expect(() => tolkKalender("<html><body>Ny design</body></html>")).toThrow(BirFeil);
    expect(() => tolkKalender(kalender("Brumaire 2026", []))).toThrow(/månedsoverskriften/);
  });

  it("en ukjent fraksjon beholdes med ikonnavnet", () => {
    expect(tolkKalender(kalender("Desember 2026", [["tekstiler", ["3. des"]]]))).toEqual([
      { fraksjon: "tekstiler", dato: "2026-12-03" },
    ]);
  });

  it("søkesvaret tolkes, og rader uten id faller ut", () => {
    expect(
      tolkSok([
        { Title: HASTEIN.navn, SubTitle: "Bergen", Id: HASTEIN.id, RealEstateId: HASTEIN.eiendom },
        { Title: "Uten id" },
      ]),
    ).toEqual([{ id: HASTEIN.id, navn: HASTEIN.navn, sted: "Bergen", eiendom: HASTEIN.eiendom }]);
    expect(() => tolkSok({ feil: true })).toThrow(BirFeil);
  });

  it("hvitelista er bare søk og kalender", () => {
    expect(TILLATTE_KALL.map((k) => k.hva)).toEqual([
      "søk etter adresse eller selskap",
      "tømmekalenderen for én oppføring",
    ]);
  });
});

describe("kobling og henting", () => {
  const aar = Number(osloIDag().slice(0, 4)) + 1;

  it("kobling henter datoene med en gang, og skjermen får neste per fraksjon", async () => {
    const orgId = await nyOrg();
    birSvarer(kalender(`Mars ${aar}`, [["restavfall", ["2. mar", "9. mar"]], ["papirOgPlast", ["4. mar"]]]));
    const status = await withOrg(orgId, (db) => kobleBir(db, orgId, KARI, HASTEIN));
    expect(status?.feil).toBeNull();
    expect(status?.datoer).toHaveLength(3);
    expect(await withOrg(orgId, (db) => tommedagerForSkjerm(db, orgId))).toEqual([
      { fraksjon: "rest", etikett: "Restavfall", dato: `${aar}-03-02` },
      { fraksjon: "papir", etikett: "Papir og plast", dato: `${aar}-03-04` },
    ]);
  });

  it("en feilende henting beholder de gamle datoene og noterer feilen", async () => {
    const orgId = await nyOrg();
    birSvarer(kalender(`April ${aar}`, [["restavfall", ["6. apr"]]]));
    await withOrg(orgId, (db) => kobleBir(db, orgId, KARI, HASTEIN));

    birSvarer("<html>ny nettside</html>");
    const r = await withOrg(orgId, (db) => synkBir(db, orgId));
    expect(r.ok).toBe(false);
    // Lest i en NY transaksjon: feilen er committet, ikke rullet tilbake.
    const status = await withOrg(orgId, (db) => hentBirStatus(db, orgId));
    expect(status?.feil).toMatch(/Kjente ikke igjen/);
    expect(status?.datoer.map((d) => d.dato)).toEqual([`${aar}-04-06`]);

    birSvarer(kalender(`April ${aar}`, [["restavfall", ["13. apr"]]]));
    await withOrg(orgId, (db) => synkBir(db, orgId));
    const etter = await withOrg(orgId, (db) => hentBirStatus(db, orgId));
    expect(etter?.feil).toBeNull();
    expect(etter?.datoer.map((d) => d.dato)).toEqual([`${aar}-04-13`]);
  });

  it("nettfeil ved kobling: koblingen står, med feilen synlig", async () => {
    const orgId = await nyOrg();
    birSvarer(new Error("ECONNREFUSED"));
    const status = await withOrg(orgId, (db) => kobleBir(db, orgId, KARI, HASTEIN));
    expect(status?.navn).toBe(HASTEIN.navn);
    expect(status?.feil).toBe("Fikk ikke kontakt med bir.no");
  });

  it("passerte datoer lagres ikke", async () => {
    const orgId = await nyOrg();
    birSvarer(kalender("Januar 2020", [["restavfall", ["6. jan"]]]));
    const status = await withOrg(orgId, (db) => kobleBir(db, orgId, KARI, HASTEIN));
    expect(status?.datoer).toEqual([]);
  });

  it("uten kobling er feltet borte (null), og frakobling fjerner datoene", async () => {
    const orgId = await nyOrg();
    expect(await withOrg(orgId, (db) => tommedagerForSkjerm(db, orgId))).toBeNull();
    birSvarer(kalender(`Mai ${aar}`, [["restavfall", ["4. mai"]]]));
    await withOrg(orgId, (db) => kobleBir(db, orgId, KARI, HASTEIN));
    await withOrg(orgId, (db) => kobleFraBir(db, orgId, KARI));
    expect(await withOrg(orgId, (db) => tommedagerForSkjerm(db, orgId))).toBeNull();
    const { rows } = await eier.query("SELECT count(*)::int AS n FROM bir_pickups WHERE org_id = $1", [orgId]);
    expect(rows[0].n).toBe(0);
  });

  it("en ugyldig BIR-id sendes aldri til BIR", async () => {
    const orgId = await nyOrg();
    const f = birSvarer("");
    await eier.query(
      "INSERT INTO bir_settings (org_id, bir_id, bir_name, connected_by) VALUES ($1, '../../admin', 'x', 'Kari')",
      [orgId],
    );
    const r = await withOrg(orgId, (db) => synkBir(db, orgId));
    expect(r).toEqual({ ok: false, feil: "Ugyldig BIR-id" });
    expect(f).not.toHaveBeenCalled();
  });
});
