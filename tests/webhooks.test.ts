/**
 * Webhooks — ny i v2, ingen v1-fasit. Tyngdepunktet er tre ting: SSRF-vernet i
 * URL-valideringen (kunden oppgir en adresse VI poster til, og containeren står på samme
 * nett som Postgres), formatkontraktene per måltype (Teams vil ha Adaptive Card, generisk
 * er en JSON-kontrakt utad), og at utsending feiler STILLE — en død kanal skal aldri velte
 * handlingen som utløste varselet.
 */

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool, type PoolClient } from "pg";
import { lukkPooler, withOrg } from "../src/db/client";
import { anonymAktor } from "../src/lib/aktor";
import { hentHendelser } from "../src/lib/hendelser";
import {
  byggKropp,
  endreWebhook,
  hentWebhooks,
  lesEvents,
  opprettWebhook,
  sendTilWebhook,
  slettWebhook,
  validerWebhookUrl,
  varsleWebhooks,
  webhookInn,
} from "../src/lib/webhooks";

const KARI = anonymAktor("Kari");

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
    await eier.query("DELETE FROM org_webhooks WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM audit_events WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM organizations WHERE id = $1", [id]);
  }
});

async function nyOrg(navn = "Webhooklaget"): Promise<string> {
  const id = `webhooks-${randomUUID()}`;
  await eier.query("INSERT INTO organizations (id, name, slug, active) VALUES ($1,$2,$3,true)", [
    id, navn, id,
  ]);
  ryddOrg.push(id);
  return id;
}

const GYLDIG = {
  name: "Styrets kanal",
  targetType: "discord" as const,
  url: "https://discord.com/api/webhooks/123/abc",
  events: ["avvik.nytt" as const],
  active: true,
};

describe("URL-valideringen (SSRF-vernet)", () => {
  it("godtar en offentlig https-adresse", () => {
    expect(validerWebhookUrl("https://hooks.slack.com/services/T0/B0/x")).toBeNull();
  });

  it.each([
    ["http uten TLS", "http://example.com/hook"],
    ["localhost", "https://localhost/hook"],
    ["rent tjenestenavn", "https://postgres/hook"],
    ["10.x", "https://10.0.0.5/hook"],
    ["172.16–31.x", "https://172.18.0.2/hook"],
    ["192.168.x", "https://192.168.1.1/hook"],
    ["link-local", "https://169.254.169.254/latest/meta-data"],
    ["loopback", "https://127.0.0.1/hook"],
    [".internal", "https://db.internal/hook"],
    ["ipv6 loopback", "https://[::1]/hook"],
    ["innbakt brukernavn", "https://a:b@example.com/hook"],
    ["ikke en URL", "hooks.slack.com/x"],
  ])("avviser %s", (_navn, url) => {
    expect(validerWebhookUrl(url)).not.toBeNull();
  });

  it("webhookInn avviser intern adresse med norsk melding", () => {
    const res = webhookInn.safeParse({ ...GYLDIG, url: "https://192.168.1.10/hook" });
    expect(res.success).toBe(false);
  });

  it("webhookInn krever minst én hendelse", () => {
    expect(webhookInn.safeParse({ ...GYLDIG, events: [] }).success).toBe(false);
  });
});

describe("lesEvents", () => {
  it("leser en gyldig liste og filtrerer ukjente nøkler", () => {
    expect(lesEvents('["avvik.nytt","tull.tøys"]')).toEqual(["avvik.nytt"]);
  });

  it("ødelagt JSON leses som tom liste, ikke som krasj", () => {
    expect(lesEvents("ikke json")).toEqual([]);
    expect(lesEvents('{"a":1}')).toEqual([]);
  });
});

describe("formatene (kontrakter mot tredjepart)", () => {
  const melding = {
    hendelse: "avvik.nytt" as const,
    tittel: "Nytt avvik #7: Lekkasje",
    tekst: "Meldt av Kari",
    lenke: "https://app.example/avvik/x",
    data: { nummer: 7 },
  };

  it("discord: { content } med orgnavn og lenke i <> (ingen forhåndsvisning)", () => {
    const kropp = byggKropp("discord", "Testlaget", melding) as { content: string };
    expect(kropp.content).toContain("Testlaget");
    expect(kropp.content).toContain("<https://app.example/avvik/x>");
  });

  it("slack: { text } med lenke i slack-format", () => {
    const kropp = byggKropp("slack", "Testlaget", melding) as { text: string };
    expect(kropp.text).toContain("<https://app.example/avvik/x|Åpne i DriftIQ>");
  });

  it("teams: Adaptive Card i message-konvolutt — ikke ren tekst", () => {
    const kropp = byggKropp("teams", "Testlaget", melding) as {
      type: string;
      attachments: Array<{ contentType: string; content: { type: string; body: unknown[]; actions?: unknown[] } }>;
    };
    expect(kropp.type).toBe("message");
    expect(kropp.attachments[0]!.contentType).toBe("application/vnd.microsoft.card.adaptive");
    expect(kropp.attachments[0]!.content.type).toBe("AdaptiveCard");
    expect(kropp.attachments[0]!.content.actions).toHaveLength(1);
  });

  it("generisk: hele hendelsen som strukturert JSON — feltene er en kontrakt utad", () => {
    const kropp = byggKropp("generisk", "Testlaget", melding) as Record<string, unknown>;
    expect(kropp).toMatchObject({
      hendelse: "avvik.nytt",
      organisasjon: "Testlaget",
      tittel: melding.tittel,
      tekst: melding.tekst,
      lenke: melding.lenke,
      data: { nummer: 7 },
    });
    expect(typeof kropp.tidspunkt).toBe("string");
  });
});

describe("CRUD og hendelseslogg", () => {
  it("oppretter, endrer og sletter — og fører alt i hendelsesloggen", async () => {
    const org = await nyOrg();
    const ny = await withOrg(org, (db) => opprettWebhook(db, org, KARI, GYLDIG));
    expect(ny.events).toEqual(["avvik.nytt"]);

    await withOrg(org, (db) =>
      endreWebhook(db, org, ny.id, KARI, { ...GYLDIG, name: "Nytt navn", events: ["avvik.nytt", "oppgave.fullfort"] }),
    );
    const [endret] = await withOrg(org, (db) => hentWebhooks(db, org));
    expect(endret!.name).toBe("Nytt navn");
    expect(endret!.events).toEqual(["avvik.nytt", "oppgave.fullfort"]);

    await withOrg(org, (db) => slettWebhook(db, org, ny.id, KARI));
    expect(await withOrg(org, (db) => hentWebhooks(db, org))).toEqual([]);

    const { hendelser } = await withOrg(org, (db) => hentHendelser(db, org));
    expect(hendelser.map((h) => h.event)).toEqual([
      expect.stringContaining("Slettet webhook"),
      expect.stringContaining("Endret webhook"),
      expect.stringContaining("Opprettet webhook"),
    ]);
  });

  it("org A ser aldri org Bs webhooks", async () => {
    const a = await nyOrg("A");
    const b = await nyOrg("B");
    await withOrg(a, (db) => opprettWebhook(db, a, KARI, GYLDIG));
    expect(await withOrg(b, (db) => hentWebhooks(db, b))).toEqual([]);
  });
});

describe("utsending", () => {
  const melding = { hendelse: "avvik.nytt" as const, tittel: "T", tekst: "x", lenke: null };

  it("poster til aktive webhooks som abonnerer på hendelsen — og bare dem", async () => {
    const org = await nyOrg();
    const treff = await withOrg(org, (db) => opprettWebhook(db, org, KARI, GYLDIG));
    await withOrg(org, (db) =>
      opprettWebhook(db, org, KARI, { ...GYLDIG, name: "Feil hendelse", events: ["kontrakt.utloper"] }),
    );
    await withOrg(org, (db) =>
      opprettWebhook(db, org, KARI, { ...GYLDIG, name: "Avslått", active: false }),
    );

    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await varsleWebhooks(org, melding);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const rader = await withOrg(org, (db) => hentWebhooks(db, org));
    const sendt = rader.find((r) => r.id === treff.id)!;
    expect(sendt.lastOk).toBe(true);
    expect(sendt.lastError).toBeNull();
    // De to andre er aldri forsøkt — statusen skal stå urørt, ikke vise en sending som
    // ikke skjedde.
    expect(rader.filter((r) => r.id !== treff.id).every((r) => r.lastAttemptAt === null)).toBe(true);
  });

  it("en feilende mottaker føres på raden og kaster ALDRI", async () => {
    const org = await nyOrg();
    const krok = await withOrg(org, (db) => opprettWebhook(db, org, KARI, GYLDIG));
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));

    await expect(varsleWebhooks(org, melding)).resolves.toBeUndefined();

    const [rad] = await withOrg(org, (db) => hentWebhooks(db, org));
    expect(rad!.id).toBe(krok.id);
    expect(rad!.lastOk).toBe(false);
    expect(rad!.lastError).toBe("HTTP 404");
  });

  it("nettverksfeil kaster heller ikke", async () => {
    const org = await nyOrg();
    await withOrg(org, (db) => opprettWebhook(db, org, KARI, GYLDIG));
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    }));

    await expect(varsleWebhooks(org, melding)).resolves.toBeUndefined();
    const [rad] = await withOrg(org, (db) => hentWebhooks(db, org));
    expect(rad!.lastOk).toBe(false);
    expect(rad!.lastError).toContain("ENOTFOUND");
  });

  it("en lagret intern adresse stoppes ved sending uten at fetch kalles", async () => {
    // Raden kan være eldre enn valideringsregelen — sendingen er den farlige operasjonen,
    // så vernet må sitte der også, ikke bare i skjemaet.
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const resultat = await sendTilWebhook(
      { targetType: "generisk", url: "https://10.0.0.5/hook" },
      "Testlaget",
      melding,
    );
    expect(resultat.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
