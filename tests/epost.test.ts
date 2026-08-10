/**
 * Domenevakten.
 *
 * Dette er ikke en kosmetisk test. Testbasen er en kopi av produksjon og inneholder ekte,
 * leverbare adresser — uten vakten sender testmiljøet ekte e-post til ekte mennesker, og de
 * personlige varslene er PÅ som standard for alle.
 *
 * Vakten leser miljøvariabelen ved modullasting, så hver test må laste modulen på nytt.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

async function medFilter(verdi: string | undefined) {
  vi.resetModules();
  if (verdi === undefined) delete process.env.EPOST_TILLATTE_DOMENER;
  else process.env.EPOST_TILLATTE_DOMENER = verdi;
  return (await import("../src/lib/epost")).mottakerTillatt;
}

afterEach(() => {
  delete process.env.EPOST_TILLATTE_DOMENER;
});

describe("fornavn", () => {
  // Tiltaleordet i tre av malene. Bommer den, ser hver e-post vi sender slurvete ut.
  const f = async (navn: string) => (await import("../src/lib/epost")).fornavn(navn);

  it("tar første ord", async () => {
    expect(await f("Tore Olsen")).toBe("Tore");
  });

  it("hopper over mellomnavn — de står MELLOM for- og etternavn", async () => {
    expect(await f("Anne Marie Berg Hansen")).toBe("Anne");
  });

  it("takler ett enkelt navn", async () => {
    expect(await f("Vaktmesteren")).toBe("Vaktmesteren");
  });

  it("snur når navnet er skrevet etternavn først", async () => {
    // Uten dette ble tiltalen «Hei Olsen,,» — kommaet ble med inn i e-posten.
    expect(await f("Olsen, Tore")).toBe("Tore");
  });

  it("faller tilbake til etternavnet når det ikke står noe etter kommaet", async () => {
    expect(await f("Olsen,")).toBe("Olsen");
  });

  it("escaper navnet — det går rett inn i en HTML-mal", async () => {
    expect(await f("<script>")).toBe("&lt;script&gt;");
  });
});

describe("mottakerTillatt", () => {
  it("slipper gjennom alt når vakten ikke er satt", async () => {
    // Med vilje: produksjon skal ikke være avhengig av at noen husker å konfigurere den,
    // og en glemt variabel skal aldri kunne gjøre kundene stille.
    const tillatt = await medFilter(undefined);
    expect(tillatt("hvem.som.helst@ekte-borettslag.no")).toBe(true);
  });

  it("slipper gjennom alt når variabelen er tom", async () => {
    const tillatt = await medFilter("   ");
    expect(tillatt("noen@ekte.no")).toBe(true);
  });

  it("tillater et helt domene uten @", async () => {
    const tillatt = await medFilter("driftiq.test");
    expect(tillatt("kari@driftiq.test")).toBe(true);
    expect(tillatt("kari@ekte-borettslag.no")).toBe(false);
  });

  it("tillater én nøyaktig adresse når oppføringen har @", async () => {
    const tillatt = await medFilter("meg@gmail.com");
    expect(tillatt("meg@gmail.com")).toBe(true);
    // Resten av gmail.com skal IKKE åpnes av at én adresse der er tillatt.
    expect(tillatt("noen.andre@gmail.com")).toBe(false);
  });

  it("håndterer flere oppføringer og blander domener og adresser", async () => {
    const tillatt = await medFilter("driftiq.test, meg@gmail.com ,example.com");
    expect(tillatt("a@driftiq.test")).toBe(true);
    expect(tillatt("meg@gmail.com")).toBe(true);
    expect(tillatt("b@example.com")).toBe(true);
    expect(tillatt("c@ekte.no")).toBe(false);
  });

  it("er ufølsom for store bokstaver og mellomrom", async () => {
    const tillatt = await medFilter("DriftIQ.Test");
    expect(tillatt("  Kari@DRIFTIQ.TEST  ")).toBe(true);
  });

  it("blokkerer tom eller ugyldig adresse når vakten er på", async () => {
    const tillatt = await medFilter("driftiq.test");
    expect(tillatt("")).toBe(false);
    expect(tillatt("ikke-en-adresse")).toBe(false);
  });
});
