/**
 * Fylker på boligbyggelag (01.10.2026). Ingen v1-forgjenger — v1 hadde region som fritekst,
 * og det var nettopp det som ga både «Vestland» og «Vestlandet» i registeret.
 *
 * Tyngdepunktet: fylkesnummer valideres mot den faste lista, flere fylker per lag lagres
 * unikt og sortert, og den gamle friteksten ryddes først når noen faktisk har valgt fylke.
 * Selve normaliseringen i `drizzle/0069_bbl_fylker.sql` kjører ved oppstart og testes ikke
 * her; at enumen, SQL-en og `lib/fylker.ts` har samme fylker, sjekkes nederst.
 */

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { lukkPooler, withoutRls } from "../src/db/client";
import { bblInn, endre, opprett } from "../src/lib/bbl";
import { FYLKER, FYLKESNR, fylkesliste } from "../src/lib/fylker";

let eierPool: Pool;
let eier: PoolClient;
const ryddBbl: string[] = [];

beforeAll(async () => {
  eierPool = new Pool({ connectionString: process.env.DATABASE_URL! });
  eier = await eierPool.connect();
});

afterEach(async () => {
  for (const id of ryddBbl.splice(0)) {
    await eier.query("DELETE FROM bbl WHERE id = $1", [id]);
  }
});

afterAll(async () => {
  eier.release();
  await eierPool.end();
  await lukkPooler();
});

const i = <T>(fn: (db: Parameters<Parameters<typeof withoutRls>[1]>[0]) => Promise<T>) =>
  withoutRls("plattformpanel", fn);

describe("fylker på boligbyggelag", () => {
  it("lagrer flere fylker unikt og sortert, og tom liste som ikke satt", async () => {
    const lag = await i((db) =>
      opprett(db, bblInn.parse({ name: `Test BBL ${randomUUID().slice(0, 8)}`, countyCodes: ["46", "11", "46"] })),
    );
    ryddBbl.push(lag.id);
    expect(lag.countyCodes).toEqual(["11", "46"]);
    expect(fylkesliste(lag.countyCodes)).toBe("Rogaland, Vestland");

    const tom = await i((db) => endre(db, lag.id, { countyCodes: [] }));
    expect(tom.countyCodes).toBeNull();
  });

  it("avviser noe som ikke er et fylkesnummer", () => {
    expect(bblInn.safeParse({ name: "X", countyCodes: ["12"] }).success).toBe(false);
    expect(bblInn.safeParse({ name: "X", countyCodes: ["Vestlandet"] }).success).toBe(false);
  });

  it("rydder den gamle friteksten først når noen velger fylke", async () => {
    const id = randomUUID();
    await eier.query("INSERT INTO bbl (id, name, region, active) VALUES ($1,$2,'Hordaland',true)", [
      id,
      `Test BBL ${id.slice(0, 8)}`,
    ]);
    ryddBbl.push(id);

    const navnebytte = await i((db) => endre(db, id, { name: `Nytt navn ${id.slice(0, 8)}` }));
    expect(navnebytte.region).toBe("Hordaland");

    const valgt = await i((db) => endre(db, id, { countyCodes: ["46"] }));
    expect(valgt.region).toBeNull();
    expect(valgt.countyCodes).toEqual(["46"]);
  });

  it("har samme fylkesnummer i databasens enum som i lib/fylker.ts", async () => {
    const { rows } = await eier.query<{ enumlabel: string }>(
      `SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'fylkeenum' ORDER BY e.enumsortorder`,
    );
    expect(rows.map((r) => r.enumlabel)).toEqual([...FYLKESNR]);
  });

  it("migrasjonen kjenner alle fylkene i lib/fylker.ts, med samme nummer", () => {
    const sqlTekst = readFileSync("drizzle/0069_bbl_fylker.sql", "utf8");
    for (const f of FYLKER) {
      expect(sqlTekst).toContain(`WHEN '${f.navn.toLowerCase()}' THEN '${f.nr}'`);
    }
  });
});
