/**
 * Varig lagring av fornyede OAuth-tokens — UTENFOR forespørselens transaksjon.
 *
 * Bakgrunn (Easee, 08.–12.09.2026): `medToken()` fornyet tokenet inne i jobbens `withOrg`,
 * et senere kall i samme synk feilet, transaksjonen rullet tilbake — og med den det nye
 * tokenparet. Easee roterer refresh-tokenet ved hver fornying og avviser det gamle
 * etterpå («InvalidRefreshToken», kode 104), så basen sto igjen med et token Easee
 * allerede hadde brukt opp. Hver natt etterpå: 401, Discord-varsel, ingen synk — og
 * `last_error` tom, for den ble rullet tilbake den også. Fiken har samme mønster og
 * samme vern.
 *
 * Et rotert token er en sidevirkning hos tredjeparten som ikke kan rulles tilbake.
 * Derfor skrives det i sin egen tilkobling som committer med én gang. `withoutRls` er
 * bare veien til en tilkobling utenfor `withOrg` — skrivingen skal filtrere på rad-id OG
 * `org_id` som alle andre spørringer, og den rører kun tokenkolonnene på koblingsraden.
 */

import { type Db, withoutRls } from "../db/client";

export async function lagreTokenerVarig(skriv: (db: Db) => Promise<unknown>): Promise<void> {
  await withoutRls("tokenlagring", skriv);
}
