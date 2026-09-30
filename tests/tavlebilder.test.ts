/**
 * Oppslagstavla — bilder og PDF i ett oppslag. Ingen v1-forgjenger; bygget for omleggingen
 * 30.09.2026 (docs/oppslagstavle.md «Bilder og PDF»).
 *
 * Tyngdepunktet: at alt som lastes opp blir WebP-sider i riktig rekkefølge (en PDF blir én
 * side per PDF-side, HEIC fra iPhone kan leses), at en kladd aldri når skjermene, at fjerning
 * rydder filene, og at bildeoppslag fra før omleggingen viser det samme etter migreringen.
 * Konverteringen kjører de ekte verktøyene i imaget (vips, pdftoppm) — det er dem som kan svikte.
 */

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { lukkPooler, withOrg, withoutRls } from "../src/db/client";
import type { ApiFeil } from "../src/lib/api";
import { anonymAktor } from "../src/lib/aktor";
import { filSti, slettFil } from "../src/lib/lagring";
import {
  endreOppslag,
  endreSide,
  hentOppslag,
  innholdForSkjerm,
  kobleSkjerm,
  leggTilSider,
  opprettBildekladd,
  ryddKladder,
  settSiderekkefolge,
  sideForSkjerm,
  sjekkKobling,
  slettOppslag,
  slettSide,
  startKobling,
} from "../src/lib/oppslagstavle";
import {
  MAKS_KANT,
  MAKS_OPPLASTING,
  MAKS_SIDER,
  bildeoppsummering,
  filFeil,
  opplastingstype,
  oppslagFeil,
  osloIDag,
  samletVisningstid,
} from "../src/lib/oppslagstavleregler";
import { sidebilderFraFil } from "../src/lib/tavlebilder";

const KARI = anonymAktor("Kari");
const MAPPE = "oppslagstavle";
const iDag = osloIDag();
const publiser = { tittel: "", fra: iDag, til: iDag, alleSkjermer: true, skjermIder: [] as string[], sekunder: 8 };

let eierPool: Pool;
let eier: PoolClient;
let tmp: string;
const ryddOrg: string[] = [];
const ryddKoder: string[] = [];

beforeAll(async () => {
  eierPool = new Pool({ connectionString: process.env.DATABASE_URL! });
  eier = await eierPool.connect();
  tmp = mkdtempSync(path.join(os.tmpdir(), "tavlebilder-test-"));
});

afterAll(async () => {
  rmSync(tmp, { recursive: true, force: true });
  eier.release();
  await eierPool.end();
  await lukkPooler();
});

afterEach(async () => {
  for (const kode of ryddKoder.splice(0)) await eier.query("DELETE FROM board_pairings WHERE code = $1", [kode]);
  for (const id of ryddOrg.splice(0)) {
    // Filene først: radene forsvinner med oppslagene, filene gjør ikke.
    const { rows } = await eier.query("SELECT file_name FROM board_post_pages WHERE org_id = $1", [id]);
    for (const r of rows) await slettFil(id, MAPPE, r.file_name);
    await eier.query("DELETE FROM board_posts WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM board_pairings WHERE screen_id IN (SELECT id FROM board_screens WHERE org_id = $1)", [id]);
    await eier.query("DELETE FROM board_screens WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM audit_events WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM organizations WHERE id = $1", [id]);
  }
});

async function nyOrg(): Promise<string> {
  const id = `bilder-${randomUUID()}`;
  await eier.query("INSERT INTO organizations (id, name, slug, active) VALUES ($1,'Bildelaget',$2,true)", [id, id]);
  ryddOrg.push(id);
  return id;
}

async function feilFra(fn: () => Promise<unknown>): Promise<ApiFeil> {
  try {
    await fn();
  } catch (e) {
    return e as ApiFeil;
  }
  throw new Error("Forventet feil, men kallet lyktes");
}

async function kobletSkjerm(orgId: string, navn = "A") {
  const k = await startKobling();
  ryddKoder.push(k.kode);
  const skjerm = await withOrg(orgId, (db) => kobleSkjerm(db, orgId, KARI, { kode: k.kode, navn, adresse: null, retning: "liggende" }));
  const svar = await sjekkKobling(k.hemmelighet);
  if (svar.status !== "koblet") throw new Error("ikke koblet");
  return { skjerm, token: svar.token };
}

const medToken = (t: string) => new Request("http://localhost/", { headers: { authorization: `Bearer ${t}` } });

// --- Filer å laste opp ------------------------------------------------------------------

/** Et PNG-bilde i gitt størrelse, laget med vips i imaget. */
function png(bredde: number, hoyde: number, navn = "bilde.png"): File {
  const sti = path.join(tmp, `${randomUUID()}.png`);
  execFileSync("vips", ["black", sti, String(bredde), String(hoyde)]);
  return new File([new Uint8Array(readFileSync(sti))], navn, { type: "image/png" });
}

/** En gyldig PDF med `sider` tomme A4-sider, bygget for hånd (med riktig xref). */
function pdf(sider: number, navn = "lysbilder.pdf"): File {
  const objekter = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Count ${sider} /Kids [${Array.from({ length: sider }, (_, i) => `${i + 3} 0 R`).join(" ")}] >>`,
    ...Array.from({ length: sider }, () => "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] >>"),
  ];
  let ut = "%PDF-1.4\n";
  const plasser: number[] = [];
  objekter.forEach((o, i) => {
    plasser.push(ut.length);
    ut += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = ut.length;
  ut += `xref\n0 ${objekter.length + 1}\n0000000000 65535 f \n${plasser.map((p) => `${String(p).padStart(10, "0")} 00000 n \n`).join("")}`;
  ut += `trailer\n<< /Size ${objekter.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new File([ut], navn, { type: "application/pdf" });
}

/** Et ekte HEIC-bilde (640 × 480, kodet med libheif/x265), slik en iPhone sender det. */
const heic = (type = "image/heic") =>
  new File([new Uint8Array(readFileSync(path.join(process.cwd(), "tests", "fixtures", "iphone.heic")))], "IMG_0042.HEIC", { type });

const erWebp = (b: Buffer) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP";

/** En kladd med filene lastet opp i rekkefølge. */
async function kladdMed(orgId: string, ...filer: File[]) {
  const { id } = await withOrg(orgId, (db) => opprettBildekladd(db, orgId, KARI));
  let sider: Awaited<ReturnType<typeof leggTilSider>> = [];
  for (const f of filer) sider = await withOrg(orgId, (db) => leggTilSider(db, orgId, id, f));
  return { id, sider };
}

const filnavn = async (sideId: string) =>
  (await eier.query("SELECT file_name FROM board_post_pages WHERE id = $1", [sideId])).rows[0]?.file_name as string | undefined;

describe("konvertering", () => {
  it("et bilde blir WebP og skaleres ned til maks 3840 px på lengste side", async () => {
    const [side, ...flere] = await sidebilderFraFil(png(4200, 210), MAKS_SIDER);
    expect(flere).toEqual([]);
    expect(erWebp(side!.data)).toBe(true);
    expect(side).toMatchObject({ bredde: MAKS_KANT, hoyde: 192, tilpasning: "dekk" });
    // Et lite bilde skaleres aldri OPP.
    expect((await sidebilderFraFil(png(320, 200), MAKS_SIDER))[0]).toMatchObject({ bredde: 320, hoyde: 200 });
  });

  it("HEIC fra iPhone leses og blir WebP — også når nettleseren ikke sender MIME-type", async () => {
    for (const fil of [heic(), heic("")]) {
      const [side] = await sidebilderFraFil(fil, MAKS_SIDER);
      expect(erWebp(side!.data)).toBe(true);
      expect(side).toMatchObject({ bredde: 640, hoyde: 480 });
    }
  });

  it("en PDF blir ett bilde per side, som vises helt og ikke beskjæres", async () => {
    const sider = await sidebilderFraFil(pdf(3), MAKS_SIDER);
    expect(sider).toHaveLength(3);
    for (const s of sider) {
      expect(erWebp(s.data)).toBe(true);
      expect(s.tilpasning).toBe("hele");
      // Liggende A4: lengste kant er bredden.
      expect(s.bredde).toBeGreaterThan(s.hoyde!);
    }
  });

  it("en PDF med flere sider enn det er plass til, avvises hel med antallet som får plass", async () => {
    expect((await feilFra(() => sidebilderFraFil(pdf(MAKS_SIDER + 1), MAKS_SIDER))).message).toBe(
      `PDF-en har ${MAKS_SIDER + 1} sider. Et oppslag kan ha ${MAKS_SIDER} bilder.`,
    );
    const f = await feilFra(() => sidebilderFraFil(pdf(4), 2));
    expect(f.status).toBe(400);
    expect(f.message).toBe(`PDF-en har 4 sider, men det er bare plass til 2 til. Et oppslag kan ha ${MAKS_SIDER} bilder.`);
    expect((await feilFra(() => sidebilderFraFil(png(10, 10), 0))).message).toMatch(/Oppslaget er fullt/);
  });

  it("feil per fil: type, størrelse og innhold — samme kontroll i skjemaet og på serveren", async () => {
    const gif = new File(["GIF89a"], "dans.gif", { type: "image/gif" });
    expect(filFeil(gif)).toBe("Filtypen støttes ikke");
    expect((await feilFra(() => sidebilderFraFil(gif, MAKS_SIDER))).message).toBe("Filtypen støttes ikke");
    expect(filFeil({ name: "stor.jpg", type: "image/jpeg", size: MAKS_OPPLASTING + 1 })).toBe("For stor, maks 20 MB");
    expect(filFeil({ name: "ok.jpg", type: "image/jpeg", size: MAKS_OPPLASTING })).toBeNull();
    expect(opplastingstype({ name: "IMG_1.HEIC", type: "" })).toBe("heic");
    // En tekstfil som utgir seg for å være HEIC, stoppes ikke av endelsen — men heller ikke av MIME-typen alene:
    expect(opplastingstype({ name: "notat.heic", type: "text/plain" })).toBeNull();
    // Riktig type, men ikke et bilde: konverteringen sier fra.
    const falsk = new File(["ikke et bilde"], "falsk.jpg", { type: "image/jpeg" });
    expect((await feilFra(() => sidebilderFraFil(falsk, MAKS_SIDER))).status).toBe(400);
    const falskPdf = new File(["ikke en pdf"], "falsk.pdf", { type: "application/pdf" });
    expect((await feilFra(() => sidebilderFraFil(falskPdf, MAKS_SIDER))).message).toBe("Filen er ikke en gyldig PDF.");
  });
});

describe("sidene i et oppslag", () => {
  it("bilder og PDF-sider havner i samme liste, i den rekkefølgen de ble lastet opp", async () => {
    const orgId = await nyOrg();
    const { id, sider } = await kladdMed(orgId, png(400, 300), pdf(2), heic());
    expect(sider.map((s) => s.tilpasning)).toEqual(["dekk", "hele", "hele", "dekk"]);
    const { rows } = await eier.query("SELECT position, content_type FROM board_post_pages WHERE post_id = $1 ORDER BY position", [id]);
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2, 3]);
    expect(new Set(rows.map((r) => r.content_type))).toEqual(new Set(["image/webp"]));
    for (const s of sider) expect(existsSync(filSti(orgId, MAPPE, (await filnavn(s.id))!))).toBe(true);
  });

  it("maks ti sider: en PDF som ikke får plass, legger ikke inn noen av sidene", async () => {
    const orgId = await nyOrg();
    const { id } = await kladdMed(orgId, pdf(MAKS_SIDER - 1));
    const f = await feilFra(() => withOrg(orgId, (db) => leggTilSider(db, orgId, id, pdf(2))));
    expect(f.message).toMatch(/bare plass til 1 til/);
    const { sider } = { sider: await withOrg(orgId, (db) => leggTilSider(db, orgId, id, png(50, 50))) };
    expect(sider).toHaveLength(MAKS_SIDER);
    expect((await feilFra(() => withOrg(orgId, (db) => leggTilSider(db, orgId, id, png(50, 50))))).message).toMatch(/Oppslaget er fullt/);
  });

  it("en kladd vises verken i lista eller på skjermen før den legges ut, og kan ikke legges ut uten bilder", async () => {
    const orgId = await nyOrg();
    const { token } = await kobletSkjerm(orgId);
    const tom = await withOrg(orgId, (db) => opprettBildekladd(db, orgId, KARI));
    expect((await feilFra(() => withOrg(orgId, (db) => endreOppslag(db, orgId, tom.id, publiser)))).message).toBe("Legg til minst ett bilde");

    const { id, sider } = await kladdMed(orgId, png(200, 100), png(100, 200));
    expect(await withOrg(orgId, (db) => hentOppslag(db, orgId))).toEqual([]);
    expect((await innholdForSkjerm(medToken(token))).oppslag).toEqual([]);
    // Bildene i en kladd er heller ikke tilgjengelige for skjermen.
    expect((await feilFra(() => sideForSkjerm(medToken(token), sider[0]!.id))).status).toBe(404);

    await withOrg(orgId, (db) => endreSide(db, orgId, id, sider[1]!.id, { tekst: "Dugnaden i april", x: 20, y: 80, tilpasning: "dekk" }));
    await withOrg(orgId, (db) => endreOppslag(db, orgId, id, { ...publiser, visning: "rutenett" }));
    const [rad] = await withOrg(orgId, (db) => hentOppslag(db, orgId));
    // Uten navn får oppslaget første bildetekst som navn i lista.
    expect(rad).toMatchObject({ kind: "bilder", title: "Dugnaden i april", layoutMode: "rutenett", displaySeconds: 8 });
    const [paaSkjerm] = (await innholdForSkjerm(medToken(token))).oppslag;
    expect(paaSkjerm).toMatchObject({ type: "bilder", visning: "rutenett", sekunder: 8 });
    expect(paaSkjerm!.sider).toEqual([
      { id: sider[0]!.id, tekst: null, x: 50, y: 50, tilpasning: "dekk" },
      { id: sider[1]!.id, tekst: "Dugnaden i april", x: 20, y: 80, tilpasning: "dekk" },
    ]);
    expect((await sideForSkjerm(medToken(token), sider[0]!.id)).contentType).toBe("image/webp");
  });

  it("rekkefølgen kan endres, og må inneholde nøyaktig sidene i oppslaget", async () => {
    const orgId = await nyOrg();
    const { id, sider } = await kladdMed(orgId, png(10, 10), pdf(2));
    const [a, b, c] = sider.map((s) => s.id) as [string, string, string];
    const ny = await withOrg(orgId, (db) => settSiderekkefolge(db, orgId, id, [c, a, b]));
    expect(ny.map((s) => s.id)).toEqual([c, a, b]);
    // En side fra PDF-en er ikke lenger bundet til PDF-en: den kan stå hvor som helst.
    expect(ny.map((s) => s.tilpasning)).toEqual(["hele", "dekk", "hele"]);
    for (const feil of [[a, b], [a, b, b], [a, b, "fremmed"]]) {
      expect((await feilFra(() => withOrg(orgId, (db) => settSiderekkefolge(db, orgId, id, feil)))).status).toBe(400);
    }
  });

  it("en side som fjernes, tar fila med seg og tetter hullet i rekkefølgen", async () => {
    const orgId = await nyOrg();
    const { id, sider } = await kladdMed(orgId, pdf(3));
    const fil = filSti(orgId, MAPPE, (await filnavn(sider[1]!.id))!);
    expect(existsSync(fil)).toBe(true);
    const igjen = await withOrg(orgId, (db) => slettSide(db, orgId, id, sider[1]!.id));
    expect(igjen.map((s) => s.id)).toEqual([sider[0]!.id, sider[2]!.id]);
    expect(existsSync(fil)).toBe(false);
    const { rows } = await eier.query("SELECT position FROM board_post_pages WHERE post_id = $1 ORDER BY position", [id]);
    expect(rows.map((r) => r.position)).toEqual([0, 1]);
  });

  it("et slettet oppslag tar alle bildene med seg, og gamle kladder ryddes", async () => {
    const orgId = await nyOrg();
    const a = await kladdMed(orgId, png(10, 10), png(10, 10));
    const filer = await Promise.all(a.sider.map(async (s) => filSti(orgId, MAPPE, (await filnavn(s.id))!)));
    await withOrg(orgId, (db) => slettOppslag(db, orgId, a.id));
    expect(filer.map((f) => existsSync(f))).toEqual([false, false]);

    const gammel = await kladdMed(orgId, png(10, 10));
    const fersk = await kladdMed(orgId, png(10, 10));
    const lagtUt = await kladdMed(orgId, png(10, 10));
    await withOrg(orgId, (db) => endreOppslag(db, orgId, lagtUt.id, publiser));
    await eier.query("UPDATE board_posts SET created_at = now() - interval '25 hours' WHERE id = ANY($1)", [[gammel.id, lagtUt.id]]);
    const gammelFil = filSti(orgId, MAPPE, (await filnavn(gammel.sider[0]!.id))!);
    expect(await withoutRls("bakgrunnsjobb", (db) => ryddKladder(db, new Date(), orgId))).toBe(1);
    expect(existsSync(gammelFil)).toBe(false);
    const { rows } = await eier.query("SELECT id FROM board_posts WHERE org_id = $1", [orgId]);
    expect(rows.map((r) => r.id).sort()).toEqual([fersk.id, lagtUt.id].sort());
  });

  it("skjermen får bare bildene i sine egne oppslag, og aldri et annet borettslags", async () => {
    const orgId = await nyOrg();
    const annen = await nyOrg();
    const a = await kobletSkjerm(orgId, "A");
    const b = await kobletSkjerm(orgId, "B");
    const fremmed = await kobletSkjerm(annen);
    const { id, sider } = await kladdMed(orgId, png(10, 10));
    await withOrg(orgId, (db) => endreOppslag(db, orgId, id, { ...publiser, alleSkjermer: false, skjermIder: [b.skjerm.id] }));
    const sideId = sider[0]!.id;
    expect((await feilFra(() => sideForSkjerm(medToken(a.token), sideId))).status).toBe(404);
    expect((await feilFra(() => sideForSkjerm(medToken(fremmed.token), sideId))).status).toBe(404);
    expect((await sideForSkjerm(medToken(b.token), sideId)).contentType).toBe("image/webp");
    // En annen org kan heller ikke endre, flytte eller fjerne sidene.
    const endring = { tekst: "x", x: 1, y: 1, tilpasning: "dekk" as const };
    expect((await feilFra(() => withOrg(annen, (db) => endreSide(db, annen, id, sideId, endring)))).status).toBe(404);
    expect((await feilFra(() => withOrg(annen, (db) => slettSide(db, annen, id, sideId)))).status).toBe(404);
    expect((await feilFra(() => withOrg(annen, (db) => leggTilSider(db, annen, id, png(10, 10))))).status).toBe(404);
  });
});

describe("migreringen av bildeoppslag fra før sidene fantes", () => {
  it("ett bilde i raden blir én side med samme fil, og skjermen viser det samme som før", async () => {
    const orgId = await nyOrg();
    const { token } = await kobletSkjerm(orgId);
    const postId = randomUUID();
    const fil = `${randomUUID()}.jpg`;
    await eier.query(
      `INSERT INTO board_posts (id, org_id, kind, title, file_name, original_name, content_type, file_size, display_seconds, show_from, show_until, created_by)
       VALUES ($1,$2,'bilde','Nytt uteområde er ferdig',$3,'ute.jpg','image/jpeg',4321,10,$4,$4,'Kari')`,
      [postId, orgId, fil, iDag],
    );
    // Datasetningene fra migrasjonen, kjørt som de står. De rører bare rader med den gamle
    // typen «bilde» — og etter at migrasjonen har kjørt, finnes det ingen andre enn denne.
    const sql = readFileSync(path.join(process.cwd(), "drizzle", "0067_oppslagstavle_bilder.sql"), "utf8");
    const data = sql.slice(sql.indexOf("-- DATAMIGRERING")).split("--> statement-breakpoint");
    expect(data).toHaveLength(2);
    for (const setning of data) await eier.query(setning);

    const { rows } = await eier.query("SELECT kind, layout_mode, file_name, file_size, title FROM board_posts WHERE id = $1", [postId]);
    // Filkolonnene i raden er tømt, så fila ikke telles to ganger i kvoten.
    expect(rows[0]).toEqual({ kind: "bilder", layout_mode: "bla", file_name: null, file_size: null, title: "Nytt uteområde er ferdig" });
    const sider = (await eier.query("SELECT * FROM board_post_pages WHERE post_id = $1", [postId])).rows;
    expect(sider).toHaveLength(1);
    expect(sider[0]).toMatchObject({ org_id: orgId, position: 0, file_name: fil, content_type: "image/jpeg", file_size: 4321, fit: "dekk" });

    const [p] = (await innholdForSkjerm(medToken(token))).oppslag;
    // Samme bilde, samme tekst under, samme visningstid, fortsatt beskåret til feltet.
    expect(p).toMatchObject({ id: postId, type: "bilder", sekunder: 10, visning: "bla" });
    expect(p!.sider).toEqual([{ id: sider[0].id, tekst: "Nytt uteområde er ferdig", x: 50, y: 50, tilpasning: "dekk" }]);
    // Visningstiden 10 er ikke i lista for nye bildeoppslag, men et gammelt oppslag kan lagres uendret.
    expect(oppslagFeil({ ...publiser, type: "bilder", sekunder: 10 })).toBeNull();
    // Kjøres setningene igjen, skjer ingenting: raden har ikke lenger den gamle typen.
    for (const setning of data) await eier.query(setning);
    expect((await eier.query("SELECT count(*)::int AS n FROM board_post_pages WHERE post_id = $1", [postId])).rows[0].n).toBe(1);
    // Rydd raden selv: fila fantes aldri på disk.
    await eier.query("DELETE FROM board_posts WHERE id = $1", [postId]);
  });
});

describe("regler", () => {
  it("samlet visningstid er antall bilder ganger sekunder per bilde", () => {
    expect(samletVisningstid(4, 8)).toBe(32);
    expect(bildeoppsummering(4, 8)).toBe("4 bilder · 8 sek per bilde · 32 sek totalt");
    expect(bildeoppsummering(1, 5)).toBe("1 bilde · 5 sek per bilde · 5 sek totalt");
    // Rutenettet viser fire og fire.
    expect(samletVisningstid(9, 8, "rutenett")).toBe(24);
  });

  it("et bildeoppslag trenger ikke navn, et tekstoppslag må ha overskrift", () => {
    expect(oppslagFeil({ ...publiser, type: "bilder" })).toBeNull();
    expect(oppslagFeil({ ...publiser, type: "tekst" })).toBe("Skriv en overskrift");
    expect(oppslagFeil({ ...publiser, type: "bilder", sekunder: 12 })).toBeNull();
    expect(oppslagFeil({ ...publiser, type: "bilder", sekunder: 7 })).toBe("Ugyldig visningstid");
  });
});
