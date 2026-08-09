/**
 * Tolkningen av Enhetsregisterets rollesvar.
 *
 * v1 hadde ingen tester her, fordi parsingen lå inne i selve `fetch`-kallet og ikke kunne
 * kjøres uten nettverk. `tolkStyre` er skilt ut nettopp for å kunne testes — alt som kan
 * være feil ligger der, mens `hentStyre` bare er transporten rundt.
 *
 * Filtrene er det som betyr noe: `fratraadt` er folk som har GÅTT UT av styret, og de skal
 * ikke inviteres inn i laget.
 */

import { describe, expect, it } from "vitest";
import { normaliserNavnedel, tolkStyre } from "../src/lib/brreg";
import { formatOrgNr } from "../src/lib/orgnr";

/** Bygger et rollesvar med én rollegruppe, slik registeret faktisk svarer. */
function svar(roller: unknown[], gruppekode = "STYR") {
  return { rollegrupper: [{ type: { kode: gruppekode }, roller }] } as Parameters<typeof tolkStyre>[0];
}

const person = (fornavn: string, etternavn: string, ekstra: Record<string, unknown> = {}) => ({
  type: { kode: "MEDL" },
  person: { navn: { fornavn, etternavn } },
  ...ekstra,
});

describe("tolkStyre", () => {
  it("plukker ut navn og rolle", () => {
    const ut = tolkStyre(svar([{ type: { kode: "LEDE" }, person: { navn: { fornavn: "Kari", etternavn: "Nordmann" } } }]));
    expect(ut).toEqual([{ navn: "Kari Nordmann", rolle: "Styreleder" }]);
  });

  it("tar med mellomnavn", () => {
    const ut = tolkStyre(svar([{ type: { kode: "MEDL" }, person: { navn: { fornavn: "Ola", mellomnavn: "Berg", etternavn: "Hansen" } } }]));
    expect(ut[0]!.navn).toBe("Ola Berg Hansen");
  });

  it("utelater dem som har fratrådt", () => {
    const ut = tolkStyre(svar([person("Kari", "Nordmann", { fratraadt: true }), person("Ola", "Hansen")]));
    expect(ut.map((r) => r.navn)).toEqual(["Ola Hansen"]);
  });

  it("utelater døde personer", () => {
    const ut = tolkStyre(
      svar([
        { type: { kode: "MEDL" }, person: { erDoed: true, navn: { fornavn: "Kari", etternavn: "Nordmann" } } },
        person("Ola", "Hansen"),
      ]),
    );
    expect(ut.map((r) => r.navn)).toEqual(["Ola Hansen"]);
  });

  it("utelater roller som ikke er styreroller", () => {
    // Revisor og regnskapsfører ligger i samme svar, men skal ikke bli brukere.
    const ut = tolkStyre(svar([{ type: { kode: "REVI" }, person: { navn: { fornavn: "Rev", etternavn: "Isor" } } }, person("Ola", "Hansen")]));
    expect(ut.map((r) => r.navn)).toEqual(["Ola Hansen"]);
  });

  it("ignorerer andre rollegrupper enn styret", () => {
    expect(tolkStyre(svar([person("Ola", "Hansen")], "DAGL"))).toEqual([]);
  });

  it("sorterer etter ansvar, ikke alfabetisk", () => {
    const ut = tolkStyre(
      svar([
        { type: { kode: "VARA" }, person: { navn: { fornavn: "Anna", etternavn: "Aas" } } },
        { type: { kode: "LEDE" }, person: { navn: { fornavn: "Ola", etternavn: "Zetterberg" } } },
        { type: { kode: "MEDL" }, person: { navn: { fornavn: "Bo", etternavn: "Berg" } } },
        { type: { kode: "NEST" }, person: { navn: { fornavn: "Cato", etternavn: "Carlsen" } } },
      ]),
    );
    expect(ut.map((r) => r.rolle)).toEqual(["Styreleder", "Nestleder", "Styremedlem", "Varamedlem"]);
  });

  it("tåler et svar helt uten rollegrupper", () => {
    expect(tolkStyre({})).toEqual([]);
  });
});

describe("normaliserNavnedel", () => {
  it("gjør BARE STORE BOKSTAVER om til vanlig navneform", () => {
    expect(normaliserNavnedel("NORDMANN")).toBe("Nordmann");
  });

  it("håndterer bindestreksnavn", () => {
    expect(normaliserNavnedel("ANNE-BERIT")).toBe("Anne-Berit");
  });

  it("lar navn som allerede har små bokstaver stå urørt", () => {
    // «von der Heyde» skal ikke bli «Von Der Heyde».
    expect(normaliserNavnedel("von der Heyde")).toBe("von der Heyde");
  });
});

describe("formatOrgNr", () => {
  it("grupperer ni siffer i tre og tre", () => {
    expect(formatOrgNr("938765432")).toBe("938 765 432");
  });

  it("lar et halvskrevet nummer stå uendret", () => {
    // Skal ikke bli stille omformet til noe som SER riktig ut.
    expect(formatOrgNr("93876")).toBe("93876");
  });

  it("gir null for tom verdi", () => {
    expect(formatOrgNr(null)).toBeNull();
  });
});
