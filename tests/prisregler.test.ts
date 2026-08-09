import { describe, expect, it } from "vitest";
import {
  STANDARDTRINN,
  arssum,
  grunnpakke,
  grunnpakkeSpesifisert,
  lesModulpriser,
  lesStrengliste,
  lesTrinn,
} from "../src/lib/prisregler";

/**
 * Prismodellens regnestykke. Ren logikk, ingen database.
 *
 * Verdt egne tester fordi tallene ender på en faktura. v1 hadde regelen to steder —
 * `compute_base_fee` i backend og en kopi i `ContractModal` — og et snapshot av resultatet
 * ble lagret på kontrakten. Var de to uenige, ville fakturagrunnlaget og kontrakten vist
 * ulike beløp uten at noe krasjet.
 */

describe("grunnpakke", () => {
  it("er degressiv: hvert trinn gjelder bare andelene i sitt eget intervall", () => {
    // 50 × 280 + 100 × 180 + 50 × 120 = 14 000 + 18 000 + 6 000
    expect(grunnpakke(200, 8000, STANDARDTRINN)).toBe(38_000);
  });

  it("regner bare de andelene som faktisk finnes i et påbegynt trinn", () => {
    // 50 × 280 + 25 × 180 = 14 000 + 4 500
    expect(grunnpakke(75, 8000, STANDARDTRINN)).toBe(18_500);
  });

  it("faller aldri under gulvprisen", () => {
    // 10 × 280 = 2 800, altså under gulvet.
    expect(grunnpakke(10, 8000, STANDARDTRINN)).toBe(8_000);
  });

  it("gir gulvprisen for null og manglende andelstall", () => {
    expect(grunnpakke(0, 8000, STANDARDTRINN)).toBe(8_000);
    expect(grunnpakke(null, 8000, STANDARDTRINN)).toBe(8_000);
    expect(grunnpakke(undefined, 8000, STANDARDTRINN)).toBe(8_000);
  });

  it("stopper på siste trinn — andeler over taket koster ikke mer", () => {
    // Standardtrinnene dekker til 600. 700 andeler gir samme sum som 600.
    expect(grunnpakke(700, 8000, STANDARDTRINN)).toBe(grunnpakke(600, 8000, STANDARDTRINN));
  });

  it("sorterer trinnene selv, så rekkefølgen i databasen ikke betyr noe", () => {
    const stokket = [...STANDARDTRINN].reverse();
    expect(grunnpakke(200, 8000, stokket)).toBe(38_000);
  });
});

describe("grunnpakkeSpesifisert", () => {
  it("viser ett linje per truffet trinn, og summene stemmer med totalen", () => {
    const linjer = grunnpakkeSpesifisert(200, STANDARDTRINN);
    expect(linjer).toHaveLength(3);
    expect(linjer.map((l) => l.andelerITrinnet)).toEqual([50, 100, 50]);
    expect(linjer.reduce((n, l) => n + l.sum, 0)).toBe(38_000);
  });

  it("tar IKKE med gulvprisen — den er en grense på totalen, ikke et trinn", () => {
    const linjer = grunnpakkeSpesifisert(10, STANDARDTRINN);
    expect(linjer.reduce((n, l) => n + l.sum, 0)).toBe(2_800);
    // …mens totalen løftes til gulvet.
    expect(grunnpakke(10, 8000, STANDARDTRINN)).toBe(8_000);
  });
});

describe("arssum", () => {
  it("legger modulene til grunnpakken", () => {
    expect(
      arssum({ grunnpakke: 30_000, moduler: [{ pris: 12_000 }, { pris: 8_500 }] }),
    ).toBe(50_500);
  });

  it("trekker rabatten fra summen av grunnpakke OG moduler", () => {
    expect(arssum({ grunnpakke: 40_000, moduler: [{ pris: 10_000 }], rabattProsent: 10 })).toBe(
      45_000,
    );
  });

  it("bruker årsavgiften bare når grunnpakken mangler", () => {
    expect(arssum({ arsavgift: 25_000 })).toBe(25_000);
    // Finnes begge, vinner snapshotet av grunnpakken.
    expect(arssum({ grunnpakke: 30_000, arsavgift: 25_000 })).toBe(30_000);
  });

  it("tåler en tom kontrakt", () => {
    expect(arssum({})).toBe(0);
  });
});

describe("lesTrinn", () => {
  it("leser den norske formen", () => {
    expect(lesTrinn('[{"fra":1,"til":10,"sats":100}]')).toEqual([{ fra: 1, til: 10, sats: 100 }]);
  });

  it("leser v1s engelske form — den finnes i migrerte rader", () => {
    expect(lesTrinn('[{"from":1,"to":10,"rate":100}]')).toEqual([{ fra: 1, til: 10, sats: 100 }]);
  });

  it("faller tilbake til standardtrinnene ved tull, ikke til en tom liste", () => {
    // En tom liste ville gjort at ALLE kunder plutselig kostet gulvprisen.
    for (const tull of [null, undefined, "", "{}", "ikke json", "[]", '[{"a":1}]']) {
      expect(lesTrinn(tull)).toEqual([...STANDARDTRINN]);
    }
  });
});

describe("lesModulpriser og lesStrengliste", () => {
  it("leser modulpriser, og faller tilbake til standardprisene ved tull", () => {
    expect(lesModulpriser('{"parkering":5000}')).toEqual({ parkering: 5000 });
    expect(lesModulpriser("[]").internkontroll).toBe(12_000);
    expect(lesModulpriser("ikke json").internkontroll).toBe(12_000);
  });

  it("gir TOM liste ved tull — motsatt vei av trinnene, og det er med vilje", () => {
    // En ødelagt `hiddenModules` skal ikke skjule moduler.
    for (const tull of [null, undefined, "", "{}", "ikke json"]) {
      expect(lesStrengliste(tull)).toEqual([]);
    }
  });

  it("siler bort verdier som ikke er strenger", () => {
    expect(lesStrengliste('["parkering", 42, null, "arshjul"]')).toEqual(["parkering", "arshjul"]);
  });
});
