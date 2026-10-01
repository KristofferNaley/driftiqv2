/**
 * «Krever handling» på kundedetaljen (BL-180). Ingen v1-forgjenger — bygget fra
 * backlog-kortet og mockupen.
 *
 * Tyngdepunktet er regelsettet `kreverHandling()` som ren funksjon: hvilke punkter som
 * vises, på hvilket nivå, og at de forsvinner når de er løst. Til slutt handlingene som
 * skriver: påminnelsen (logges, går bare til ekte orgadmins, nektes for oppfylte punkter)
 * og e-postvalideringen på kunden.
 */

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { lukkPooler, withoutRls } from "../src/db/client";
import { endreKunde, hentDetalj, kundeEndring, sendPaminnelse } from "../src/lib/kundedetalj";
import { kreverHandling, PAMINNELSE, type Grunnlag } from "../src/lib/kundehandlinger";

// ── Regelsettet ─────────────────────────────────────────────────────────────────────────

const ALLE_OK = [
  "abonnement",
  "andeler",
  "enheter",
  "om_bygget",
  "styret",
  "leverandorer",
  "kontrakter",
  "arshjul",
  "rutiner",
  "dokumenter",
].map((nokkel) => ({ nokkel, etikett: nokkel, ok: true }));

const grunnlag = (endring: Partial<Grunnlag["org"]> = {}, ikkeOk: string[] = []): Grunnlag => ({
  org: { contactEmail: "styret@laget.no", orgNr: "123456789", orgForm: "BRL", ...endring },
  onboarding: ALLE_OK.map((p) => ({ ...p, ok: !ikkeOk.includes(p.nokkel) })),
});

describe("kreverHandling", () => {
  it("gir ingen punkter for en kunde der alt er på plass — kortet skjules", () => {
    expect(kreverHandling(grunnlag())).toEqual([]);
  });

  it("gir rødt punkt for manglende e-post, med inline e-postfelt", () => {
    const [p] = kreverHandling(grunnlag({ contactEmail: null }));
    expect(p).toMatchObject({ nokkel: "epost", nivaa: "rod", tittel: "Mangler e-post" });
    expect(p!.handling).toEqual({ type: "epost" });
  });

  it("regner blank e-post som manglende", () => {
    expect(kreverHandling(grunnlag({ contactEmail: "  " })).map((p) => p.nokkel)).toEqual(["epost"]);
  });

  it("gir gult punkt for manglende org.nr, med «Slå opp»", () => {
    const [p] = kreverHandling(grunnlag({ orgNr: null }));
    expect(p).toMatchObject({ nokkel: "orgnr", nivaa: "gul" });
    expect(p!.handling).toEqual({ type: "orgnr" });
  });

  it("gir ett gult punkt per onboarding-sjekk som ikke er oppfylt, med navnet på sjekken", () => {
    const punkter = kreverHandling(grunnlag({}, ["styret", "om_bygget"]));
    expect(punkter.map((p) => p.nokkel)).toEqual(["onboarding:om_bygget", "onboarding:styret"]);
    expect(punkter.every((p) => p.nivaa === "gul")).toBe(true);
    expect(punkter[0]!.tittel).toBe("Onboarding: om_bygget");
  });

  it("gir styret «Inviter styremedlem» og de andre «Send påminnelse»", () => {
    const [bygget, styret] = kreverHandling(grunnlag({}, ["styret", "om_bygget"]));
    expect(styret!.handling).toMatchObject({ type: "paaminnelse", punkt: "styret", etikett: "Inviter styremedlem" });
    expect(bygget!.handling).toMatchObject({ type: "paaminnelse", punkt: "om_bygget", etikett: "Send påminnelse" });
  });

  it("sender abonnement til fanen og andeler til Rediger — de kan ikke påminnes om", () => {
    const [abonnement, andeler] = kreverHandling(grunnlag({}, ["abonnement", "andeler"]));
    expect(abonnement!.handling).toMatchObject({ type: "fane", fane: "abonnement" });
    expect(andeler!.handling).toMatchObject({ type: "rediger" });
  });

  it("har påminnelsestekst for hvert punkt som får en påminnelsesknapp", () => {
    const punkter = kreverHandling(grunnlag({}, ALLE_OK.map((p) => p.nokkel)));
    for (const p of punkter) {
      if (p.handling.type === "paaminnelse") expect(PAMINNELSE[p.handling.punkt]).toBeDefined();
    }
  });

  it("setter røde punkter først, uansett rekkefølgen reglene står i", () => {
    const punkter = kreverHandling(grunnlag({ contactEmail: null, orgNr: null }, ["styret"]));
    expect(punkter.map((p) => p.nivaa)).toEqual(["rod", "gul", "gul"]);
    expect(punkter[0]!.nokkel).toBe("epost");
  });

  it("navngir koden når Brreg ga en selskapsform vi ikke har", () => {
    const [p] = kreverHandling({ ...grunnlag({ orgForm: null }), ukjentBrregKode: "STI" });
    expect(p!.tittel).toContain("STI");
    expect(p!.handling).toEqual({ type: "selskapsform", brregKode: "STI" });
  });

  it("gir DEMO-kunden riktige punkter: e-post, org.nr og styret", () => {
    // Slik «DEMO - Det Beste Borettslaget» ser ut i testbasen: ingen e-post, ingen org.nr,
    // én ekte bruker og «Om bygget» tom.
    const punkter = kreverHandling(
      grunnlag({ contactEmail: null, orgNr: null }, ["styret", "om_bygget"]),
    );
    expect(punkter.map((p) => p.nokkel)).toEqual([
      "epost",
      "orgnr",
      "onboarding:om_bygget",
      "onboarding:styret",
    ]);
  });
});

// ── Handlingene ─────────────────────────────────────────────────────────────────────────

let eierPool: Pool;
let eier: PoolClient;
const ryddOrg: string[] = [];
const ryddBruker: string[] = [];

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
  for (const id of ryddOrg.splice(0)) {
    await eier.query("DELETE FROM audit_events WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM user_org_memberships WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM organizations WHERE id = $1", [id]);
  }
  for (const id of ryddBruker.splice(0)) {
    await eier.query("DELETE FROM users WHERE id = $1", [id]);
  }
});

const i = <T>(fn: (db: Parameters<Parameters<typeof withoutRls>[1]>[0]) => Promise<T>) =>
  withoutRls("plattformpanel", fn);

const aktor = { navn: "Plattformadmin Test", brukerId: null };

async function nyOrg(): Promise<string> {
  const id = `kh-${randomUUID()}`;
  await eier.query("INSERT INTO organizations (id, name, slug, active) VALUES ($1,'Handlingslaget',$1,true)", [id]);
  ryddOrg.push(id);
  return id;
}

async function nyBruker(orgId: string, rolle: string, nivaa: string, aktiv = true): Promise<string> {
  const id = randomUUID();
  await eier.query(
    `INSERT INTO users (id, name, email, role, active, email_verified, created_at, updated_at)
     VALUES ($1,'Test',$2,$3,$4,true,now(),now())`,
    [id, `${id}@driftiq.test`, rolle, aktiv],
  );
  await eier.query(
    "INSERT INTO user_org_memberships (id, user_id, org_id, role) VALUES ($1,$2,$3,$4)",
    [randomUUID(), id, orgId, nivaa],
  );
  ryddBruker.push(id);
  return id;
}

describe("sendPaminnelse", () => {
  it("går bare til aktive orgadmins hos kunden, ikke plattformadmin eller deaktiverte", async () => {
    const org = await nyOrg();
    await nyBruker(org, "member", "orgadmin");
    await nyBruker(org, "member", "redigering");
    await nyBruker(org, "member", "orgadmin", false);
    await nyBruker(org, "superadmin", "orgadmin");

    // «Om bygget» og ikke styret: fire medlemskap ville i seg selv oppfylt styre-punktet.
    const etterpaa: Array<() => Promise<void>> = [];
    const svar = await i((db) => sendPaminnelse(db, org, "om_bygget", aktor, (fn) => etterpaa.push(fn)));
    expect(svar.mottakere).toBe(1);
    // Sendingen ligger i etterCommit — den kjøres ikke her, så testen sender ingen e-post.
    expect(etterpaa).toHaveLength(1);
  });

  it("logges i hendelsesloggen i samme kall", async () => {
    const org = await nyOrg();
    await nyBruker(org, "member", "orgadmin");
    await i((db) => sendPaminnelse(db, org, "om_bygget", aktor, () => {}));

    const { rows } = await eier.query("SELECT event, entity_id FROM audit_events WHERE org_id = $1", [org]);
    expect(rows).toHaveLength(1);
    expect(rows[0].entity_id).toBe("om_bygget");
    expect(rows[0].event).toContain("«Om bygget» utfylt");
  });

  it("nekter et punkt som allerede er oppfylt", async () => {
    const org = await nyOrg();
    await nyBruker(org, "member", "orgadmin");
    await nyBruker(org, "member", "orgadmin");
    await expect(i((db) => sendPaminnelse(db, org, "styret", aktor, () => {}))).rejects.toThrow(
      "allerede oppfylt",
    );
  });

  it("nekter når kunden ikke har noen orgadmin å sende til", async () => {
    const org = await nyOrg();
    await expect(i((db) => sendPaminnelse(db, org, "rutiner", aktor, () => {}))).rejects.toThrow(
      "ingen orgadmin",
    );
  });

  it("nekter punkter uten påminnelse (abonnement håndteres av oss, ikke kunden)", async () => {
    const org = await nyOrg();
    await nyBruker(org, "member", "orgadmin");
    await expect(i((db) => sendPaminnelse(db, org, "abonnement", aktor, () => {}))).rejects.toThrow();
  });
});

describe("kundens e-post", () => {
  it("avviser en ugyldig adresse og godtar tom (= fjern)", () => {
    expect(kundeEndring.safeParse({ contactEmail: "ikke-en-adresse" }).success).toBe(false);
    expect(kundeEndring.safeParse({ contactEmail: "styret@laget.no" }).success).toBe(true);
    expect(kundeEndring.safeParse({ contactEmail: "" }).success).toBe(true);
  });

  it("får punktet til å forsvinne når e-posten er lagret", async () => {
    const org = await nyOrg();
    const foer = await i((db) => hentDetalj(db, org));
    const grunn = (d: typeof foer) => ({ org: d.org, onboarding: d.onboarding.punkter });
    expect(kreverHandling(grunn(foer)).some((p) => p.nokkel === "epost")).toBe(true);

    await i((db) => endreKunde(db, org, { contactEmail: "styret@laget.no" }));
    const etter = await i((db) => hentDetalj(db, org));
    expect(kreverHandling(grunn(etter)).some((p) => p.nokkel === "epost")).toBe(false);
  });
});
