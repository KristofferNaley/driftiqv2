/**
 * `byggSerier()` — grupperingen bak grafen på oppgavens statistikkfane.
 *
 * Ren logikk uten database: fila den tester er importfri med vilje (se `lib/maleserier.ts`),
 * og reglene her er de to som gjør at en kurve kan stoles på — enheten splitter serien, og et
 * omdøpt punkt arver ikke det gamles tall.
 */

import { describe, expect, it } from "vitest";
import { byggSerier, type Utfort } from "../src/lib/maleserier";

const avlest = (
  itemId: string | null,
  text: string,
  value: string | null,
  unit: string | null,
) => ({
  itemId,
  text,
  value,
  unit,
});

describe("byggSerier", () => {
  it("samler avlesningene av ett punkt i én serie, eldste først", () => {
    const utf: Utfort[] = [
      { completedAt: "2026-03-01", punkter: [avlest("p1", "Trykk", "5.2", "bar")] },
      { completedAt: "2026-01-01", punkter: [avlest("p1", "Trykk", "4.8", "bar")] },
      { completedAt: "2026-02-01", punkter: [avlest("p1", "Trykk", "5.0", "bar")] },
    ];
    const [serie] = byggSerier(utf, ["p1"]);
    expect(serie!.malinger.map((m) => m.verdi)).toEqual([4.8, 5.0, 5.2]);
    expect(serie!.enhet).toBe("bar");
    expect(serie!.aktiv).toBe(true);
  });

  /**
   * Kjernen. Enheten på en avlesning er den som gjaldt DEN dagen, så en malendring gir to
   * sett tall som ikke kan sammenlignes. De skal bli to serier, ikke én kurve.
   */
  it("splitter serien når enheten er endret underveis", () => {
    const utf: Utfort[] = [
      { completedAt: "2026-01-01", punkter: [avlest("p1", "Trykk", "5", "bar")] },
      { completedAt: "2026-02-01", punkter: [avlest("p1", "Trykk", "500", "kPa")] },
    ];
    const serier = byggSerier(utf, ["p1"]);
    expect(serier).toHaveLength(2);
    expect(serier.map((s) => s.enhet).sort()).toEqual(["bar", "kPa"]);
    expect(serier.every((s) => s.malinger.length === 1)).toBe(true);
  });

  it("lar ikke et omdøpt punkt arve det gamles tall", () => {
    // Omdøping gir et nytt malpunkt med ny id — det er regelen i erstattSjekkliste.
    const utf: Utfort[] = [
      { completedAt: "2026-01-01", punkter: [avlest("gammel", "Trykk", "5", "bar")] },
      { completedAt: "2026-02-01", punkter: [avlest("ny", "Trykk hovedledning", "6", "bar")] },
    ];
    const serier = byggSerier(utf, ["ny"]);
    expect(serier).toHaveLength(2);
    // Den aktive ligger først, den utgåtte er fortsatt med som historikk.
    expect(serier[0]!.navn).toBe("Trykk hovedledning");
    expect(serier[0]!.aktiv).toBe(true);
    expect(serier[1]!.aktiv).toBe(false);
  });

  it("beholder avlesninger fra et slettet malpunkt, gruppert på teksten", () => {
    const utf: Utfort[] = [
      { completedAt: "2026-01-01", punkter: [avlest(null, "Trykk", "5", "bar")] },
      { completedAt: "2026-02-01", punkter: [avlest(null, "Trykk", "6", "bar")] },
    ];
    const [serie] = byggSerier(utf, []);
    expect(serie!.malinger).toHaveLength(2);
    expect(serie!.aktiv).toBe(false);
  });

  it("hopper over punkter uten verdi og verdier som ikke er tall", () => {
    const utf: Utfort[] = [
      { completedAt: "2026-01-01", punkter: [avlest("p1", "Huket av", null, null)] },
      { completedAt: "2026-02-01", punkter: [avlest("p2", "Tull", "ikke et tall", "bar")] },
      { completedAt: "2026-03-01", punkter: [avlest("p3", "Trykk", "5", "bar")] },
    ];
    const serier = byggSerier(utf, ["p1", "p2", "p3"]);
    expect(serier).toHaveLength(1);
    expect(serier[0]!.navn).toBe("Trykk");
  });

  it("bruker den nyeste teksten som etikett", () => {
    // Samme id, endret tekst uten at punktet ble et nytt — kan skje ved retting av skrivefeil
    // gjennom API-et. Etiketten skal da vise det punktet heter nå.
    const utf: Utfort[] = [
      { completedAt: "2026-01-01", punkter: [avlest("p1", "Trykk (bar)", "5", "bar")] },
      { completedAt: "2026-02-01", punkter: [avlest("p1", "Trykk", "6", "bar")] },
    ];
    const [serie] = byggSerier(utf, ["p1"]);
    expect(serie!.navn).toBe("Trykk");
    expect(serie!.malinger).toHaveLength(2);
  });

  it("gir ingen serier når ingenting er målt", () => {
    expect(byggSerier([], ["p1"])).toEqual([]);
  });
});
