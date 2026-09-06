/**
 * Fakturaadapteret for Fiken — implementerer `Fakturaadapter` (regnskapskobling.ts).
 * HTTP-laget er `fiken.ts`; koblingen og tokenet er `fikenkobling.ts`.
 *
 * Per faktura, i denne rekkefølgen, alt sekvensielt (Fiken bremser over 4 kall/s):
 *
 * 1. Kunden slås opp på `memberNumberString` = mottakerens nøkkel (seksjonens id), og
 *    opprettes hvis den mangler. Navnebytte hos eieren gir ikke ny kunde.
 * 2. Finnes en faktura med `orderReference` hos kunden fra før (ikke kreditert)? Da er
 *    den svaret — en kjøring som feilet halvveis kan sendes på nytt uten
 *    dobbeltfakturering. Er den aldri sendt, sendes den nå.
 * 3. Fakturaen opprettes med én linje. Mva følger foretaket: et sameie er normalt ikke
 *    mva-registrert (`vatType: "no"` på foretaket → `NONE` på linja, beløpet er brutto);
 *    et registrert foretak får `HIGH` med netto = brutto / 1,25.
 * 4. Sendes på e-post hvis mottakeren har adresse; ellers ligger den opprettet i Fiken.
 *
 * Lært 03.09.2026 (docs/fiken.md): `uuid` er ikke idempotent, telleren må initialiseres
 * første gang (409), og et regnskapsår som ikke er åpnet gir 400 — den meldingen skal
 * fram til styret uendret.
 */

import type { Db } from "../db/client";
import { ApiFeil } from "./api";
import {
  FikenFeil,
  finnFakturaVedReferanse,
  finnKunde,
  hentBankkontoer,
  hentFaktura,
  lovligeMvaKoder,
  opprettFaktura,
  opprettKunde,
  sendFaktura,
} from "./fiken";
import { fikenRad, gyldigToken } from "./fikenkobling";
import type { Fakturaadapter, Fakturaoppdrag, Fakturasvar } from "./regnskapskobling";

/** Kodene uten mva, i den rekkefølgen vi foretrekker dem når kontoen godtar flere. */
const UTEN_MVA = ["NONE", "EXEMPT", "OUTSIDE"];
/** Kodene med mva, med satsen som skal trekkes ut av bruttobeløpet. */
const MED_MVA: Record<string, number> = { HIGH: 25, MEDIUM: 15, LOW: 12 };

/**
 * Netto og mva-kode per linje. Brutto er det styret ser og det som faktureres. Et
 * foretak uten mva (`vatType: "no"`) fakturerer uten mva; et registrert foretak med høy
 * sats. `lovlige` er kodene Fiken sa kontoen godtar (fra en 400) — da velges den første
 * vi kan bruke: uten mva for et uregistrert foretak, med mva for et registrert.
 */
export function fikenLinje(belopOre: number, vatTypeForetak: string | null, lovlige: string[] = []): { unitPrice: number; vatType: string } {
  const registrert = vatTypeForetak !== null && vatTypeForetak !== "no";
  if (lovlige.length === 0) return registrert ? { unitPrice: Math.round(belopOre / 1.25), vatType: "HIGH" } : { unitPrice: belopOre, vatType: "NONE" };
  if (!registrert) {
    const kode = UTEN_MVA.find((k) => lovlige.includes(k));
    if (kode) return { unitPrice: belopOre, vatType: kode };
    throw new ApiFeil(400, `Kontoen krever mva-kode (${lovlige.join(", ")}), men foretaket er ikke mva-registrert — velg en avgiftsfri inntektskonto, f.eks. 3100.`);
  }
  const kode = Object.keys(MED_MVA).find((k) => lovlige.includes(k)) ?? UTEN_MVA.find((k) => lovlige.includes(k));
  if (!kode) throw new ApiFeil(400, `Kontoen godtar ingen mva-kode DriftIQ kan bruke (${lovlige.join(", ")}) — velg en annen inntektskonto.`);
  const sats = MED_MVA[kode] ?? 0;
  return { unitPrice: Math.round(belopOre / (1 + sats / 100)), vatType: kode };
}

function tilApiFeil(e: unknown, hva: string): never {
  if (e instanceof FikenFeil) throw new ApiFeil(e.status >= 400 && e.status < 500 ? 400 : 503, `${hva}: ${e.message}`);
  if (e instanceof Error && e.name === "TimeoutError") throw new ApiFeil(503, `${hva}: Fiken svarte ikke i tide`);
  throw e;
}

export const fikenFakturaadapter: Fakturaadapter = {
  system: "fiken",
  async sendFakturaer(db: Db, orgId: string, oppdrag: Fakturaoppdrag[], opts): Promise<Fakturasvar[]> {
    const rad = await fikenRad(db, orgId);
    if (!rad) throw new ApiFeil(400, "Ingen Fiken-kobling");
    const token = await gyldigToken(db, orgId);
    const slug = rad.companySlug;

    let bankkonto: string;
    try {
      const kontoer = await hentBankkontoer(token, slug);
      const aktiv = kontoer.find((k) => !k.inactive && (k.type ?? "normal") === "normal" && k.accountCode) ?? kontoer.find((k) => k.accountCode);
      if (!aktiv?.accountCode) throw new ApiFeil(400, "Foretaket i Fiken har ingen bankkonto å sette på fakturaen — legg inn en under Innstillinger i Fiken.");
      bankkonto = aktiv.accountCode;
    } catch (e) {
      tilApiFeil(e, "Bankkonto");
    }

    const svar: Fakturasvar[] = [];
    const kundeCache = new Map<string, number>();
    for (const o of oppdrag) {
      try {
        // 1. Kunden — den bærer identiteten i idempotensnøkkelen.
        let kundeId = kundeCache.get(o.mottakerNokkel);
        if (!kundeId) {
          const k = await finnKunde(token, slug, o.mottakerNokkel);
          kundeId = k?.contactId ?? (await opprettKunde(token, slug, { name: o.mottakerNavn, email: o.mottakerEpost, memberNumberString: o.mottakerNokkel }));
          kundeCache.set(o.mottakerNokkel, kundeId);
        }
        // 2. Finnes fakturaen fra før hos denne kunden? Da gjenbrukes den — men er den aldri
        //    sendt til mottakeren (forrige forsøk feilet mellom opprettelse og sending), sendes den nå.
        const eksisterende = await finnFakturaVedReferanse(token, slug, o.orderReference, kundeId);
        if (eksisterende) {
          const f = eksisterende.dispatches ? eksisterende : await hentFaktura(token, slug, eksisterende.invoiceId).catch(() => eksisterende);
          // Har Fiken allerede sendt den (fra et tidligere forsøk, eller manuelt), er den levert.
          let sendt = (f.dispatches ?? []).length > 0;
          if (o.mottakerEpost && !sendt) {
            await sendFaktura(token, slug, eksisterende.invoiceId, o.mottakerEpost);
            sendt = true;
          }
          svar.push({ linjeId: o.linjeId, externalRef: String(eksisterende.invoiceId), externalNumber: eksisterende.invoiceNumber ? String(eksisterende.invoiceNumber) : null, sendt });
          continue;
        }
        // 3. Fakturaen. Godtar ikke kontoen mva-koden vi valgte, sier Fiken hvilke den
        //    godtar («Mulige mva koder er […]») — da velges én av dem og kallet gjentas én gang.
        const lagFaktura = (linje: { unitPrice: number; vatType: string }) =>
          opprettFaktura(token, slug, {
            issueDate: o.issueDate,
            dueDate: o.dueDate,
            customerId: kundeId!,
            bankAccountCode: bankkonto,
            orderReference: o.orderReference,
            ourReference: "DriftIQ",
            invoiceText: opts.tittel.slice(0, 500),
            lines: [{ description: o.beskrivelse.slice(0, 200), unitPrice: linje.unitPrice, quantity: 1, vatType: linje.vatType, incomeAccount: o.incomeAccount }],
          });
        let invoiceId: number;
        try {
          invoiceId = await lagFaktura(fikenLinje(o.belopOre, rad.vatType));
        } catch (e) {
          const lovlige = e instanceof FikenFeil && e.status === 400 ? lovligeMvaKoder(e.message) : [];
          if (lovlige.length === 0) throw e;
          invoiceId = await lagFaktura(fikenLinje(o.belopOre, rad.vatType, lovlige));
        }
        const faktura = await hentFaktura(token, slug, invoiceId).catch(() => null);
        // 4. Sending.
        let sendt = false;
        if (o.mottakerEpost) {
          await sendFaktura(token, slug, invoiceId, o.mottakerEpost);
          sendt = true;
        }
        svar.push({ linjeId: o.linjeId, externalRef: String(invoiceId), externalNumber: faktura?.invoiceNumber ? String(faktura.invoiceNumber) : null, sendt });
      } catch (e) {
        tilApiFeil(e, `Faktura til ${o.mottakerNavn} (${svar.length} av ${oppdrag.length} opprettet før feilen; de er trygge å sende på nytt)`);
      }
    }
    return svar;
  },
};
