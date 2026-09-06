/**
 * Driftsvarsler til Discord — ny i v2, ingen v1-fasit. Tyngdepunktet er kontrakten mot
 * Discord: meldingen skal stå som «DriftIQ» med logo (samme avsenderprofil som
 * kundevarslene i webhooks.ts), og en død kanal skal aldri kaste.
 *
 * `WEBHOOK_URL` leses ved modullasting, så miljøet settes FØR dynamisk import.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("driftsvarsel", () => {
  it("poster som DriftIQ med logo og miljønavnet i teksten", async () => {
    process.env.DISCORD_WEBHOOK_URL = "https://discord.example/api/webhooks/1/x";
    const fetchMock = vi.fn(async () => new Response("", { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const { sendDriftsvarsel } = await import("../src/lib/driftsvarsel");
    await sendDriftsvarsel("Appen startet — test.");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://discord.example/api/webhooks/1/x");
    const kropp = JSON.parse(String(init.body)) as {
      username: string; avatar_url: string; content: string;
    };
    expect(kropp.username).toBe("DriftIQ");
    expect(kropp.avatar_url).toMatch(/^https?:\/\/.+\/ikon-512\.png$/);
    expect(kropp.content).toContain("Appen startet — test.");
  });

  it("en feilende kanal kaster aldri", async () => {
    process.env.DISCORD_WEBHOOK_URL = "https://discord.example/api/webhooks/1/x";
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    const { sendDriftsvarsel } = await import("../src/lib/driftsvarsel");
    await expect(sendDriftsvarsel("noe")).resolves.toBeUndefined();
  });
});
