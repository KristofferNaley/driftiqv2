/**
 * Jobbregisteret — særlig `nesteKjoring`, som må være DST-trygg: «kl. 07:00 Europe/Oslo»
 * er et annet UTC-tidspunkt sommer og vinter, og det er nettopp de to nettene i året en
 * aritmetisk beregning ville bommet på.
 */

import { describe, expect, it } from "vitest";
import { JOBBER, nesteKjoring } from "../src/lib/jobber";

describe("nesteKjoring", () => {
  it("finner neste daglige kjøring i riktig tidssone", () => {
    // 14. august 2026 kl. 12:00 UTC = 14:00 i Oslo — neste 07:00 Oslo er 15. august,
    // som er 05:00 UTC (sommertid).
    const neste = nesteKjoring("0 7 * * *", "Europe/Oslo", new Date("2026-08-14T12:00:00Z"));
    expect(neste?.toISOString()).toBe("2026-08-15T05:00:00.000Z");
  });

  it("treffer riktig ukedag for ukentlige jobber", () => {
    // 14. august 2026 er en fredag — neste søndag 04:30 Oslo er 16. august (02:30 UTC).
    const neste = nesteKjoring("30 4 * * 0", "Europe/Oslo", new Date("2026-08-14T12:00:00Z"));
    expect(neste?.toISOString()).toBe("2026-08-16T02:30:00.000Z");
  });

  it("følger klokka over sommertidsslutt", () => {
    // Sommertiden slutter 25. oktober 2026: 07:00 Oslo er 05:00 UTC dagen før skiftet,
    // 06:00 UTC dagen etter. Jobben skal treffe VEGGKLOKKA, ikke UTC-avstanden.
    const for_ = nesteKjoring("0 7 * * *", "Europe/Oslo", new Date("2026-10-23T12:00:00Z"));
    expect(for_?.toISOString()).toBe("2026-10-24T05:00:00.000Z");
    const etter = nesteKjoring("0 7 * * *", "Europe/Oslo", new Date("2026-10-25T12:00:00Z"));
    expect(etter?.toISOString()).toBe("2026-10-26T06:00:00.000Z");
  });

  it("avviser uttrykk registeret ikke skal ha", () => {
    expect(nesteKjoring("ukentlig", "Europe/Oslo")).toBeNull();
  });

  it("har unike nøkler og lesbar plan for alle jobbene", () => {
    expect(new Set(JOBBER.map((j) => j.nokkel)).size).toBe(JOBBER.length);
    expect(JOBBER.every((j) => j.plan.length > 0 && j.beskrivelse.length > 0)).toBe(true);
  });
});
