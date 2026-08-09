/**
 * Den anonyme QR-flyten. Port av v1s `/complete/{qr_token}` og `/public/routines/{token}`.
 *
 * ## Tokenet ER tilgangskontrollen
 *
 * QR-koden henger fysisk på heisen, sprinklersentralen eller vaskerommet. Leverandøren som
 * skanner den har ingen konto og skal ikke ha det — å kreve innlogging for å kvittere ut en
 * jobb ville betydd at jobben ikke ble kvittert ut.
 *
 * Sikkerheten er derfor `qrToken`: den er tilfeldig, treffer nøyaktig én rad, og ingenting
 * utenom den raden leses ut. Det er samme modell som en delingslenke.
 *
 * ## Hvorfor `withoutRls`
 *
 * Uten innlogging finnes ingen org-kontekst, og oppgaven må slås opp FØR org-en er kjent —
 * `withOrg` er umulig her, for vi vet ikke hvilken org vi skal be om. Derfor `"qr-anonym"`,
 * som er en av de begrunnede unntaksverdiene i `db/client.ts`.
 *
 * Konsekvensen er at HVER spørring her må filtrere på tokenet selv. Det finnes ikke noe
 * andre lag under som fanger en glipp, slik det gjør inne i appen.
 *
 * ## Hva som er beskyttelsen mot misbruk
 *
 * v1 har ingen ratelimit på disse endepunktene, og det har ikke v2 heller. Beskyttelsen er
 * at et gyldig token må gjettes, og at skrivingen er avgrenset: kun bilder, maks størrelse,
 * maks antall per utførelse, og lagringskvoten for org-en. Uten de grensene kunne én lekket
 * QR-kode fylt disken.
 */

import { and, asc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { withoutRls } from "../db/client";
import { organizations } from "../db/schema/organizations";
import { routines, routineSteps } from "../db/schema/rutiner";
import { completionPhotos, completions, taskChecklistItems, tasks } from "../db/schema/tasks";
import { units } from "../db/schema/units";
import { vendors } from "../db/schema/vendors";
import { ikkeFunnet, ugyldig } from "./api";
import { lagreFil } from "./lagring";
import { opprettUtkvittering, utkvitteringInn } from "./oppgaver";

/**
 * Kun bilder. Skjemaet ber om dokumentasjon på utført arbeid, og endepunktet er ANONYMT —
 * det skal ikke kunne brukes som et åpent filhotell for PDF og Word.
 */
const BILDETYPER = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

/** Per utførelse. Uten et tak kunne én lekket QR-kode fylt disken for hele installasjonen. */
const MAKS_BILDER = 4;

export const qrUtkvittering = utkvitteringInn.extend({
  /** «Hvem utfører» er valgfritt. Står det tomt, føres leverandørselskapet — se under. */
  completedBy: z.string().trim().nullish(),
});

/**
 * Konteksten skjemaet trenger: hva skal gjøres, hvor, for hvem.
 *
 * Bare feltene siden faktisk viser. Et anonymt endepunkt skal ikke returnere hele
 * oppgaveraden «for sikkerhets skyld» — alt som sendes ut, er noe hvem som helst med
 * tokenet kan lese.
 */
export async function hentQrKontekst(token: string) {
  return withoutRls("qr-anonym", async (db) => {
    const rader = await db
      .select({
        taskId: tasks.id,
        tittel: tasks.title,
        beskrivelse: tasks.description,
        frekvens: tasks.frequency,
        sted: tasks.location,
        enhetNavn: units.navn,
        orgNavn: organizations.name,
        leverandor: vendors.name,
      })
      .from(tasks)
      .innerJoin(organizations, eq(organizations.id, tasks.orgId))
      .leftJoin(vendors, eq(vendors.id, tasks.vendorId))
      .leftJoin(units, eq(units.id, tasks.unitId))
      .where(and(eq(tasks.qrToken, token), eq(tasks.active, true)))
      .limit(1);

    const rad = rader[0];
    if (!rad) throw ikkeFunnet("Ugyldig eller inaktiv QR-kode");

    const sjekkliste = await db
      .select({ id: taskChecklistItems.id, text: taskChecklistItems.text })
      .from(taskChecklistItems)
      .where(eq(taskChecklistItems.taskId, rad.taskId))
      .orderBy(asc(taskChecklistItems.order));

    return {
      tittel: rad.tittel,
      beskrivelse: rad.beskrivelse,
      frekvens: rad.frekvens,
      // Enhetskoblingen vinner over fritekstfeltet — samme fallback som inne i appen.
      sted: rad.enhetNavn ?? rad.sted,
      orgNavn: rad.orgNavn,
      leverandor: rad.leverandor,
      sjekkliste,
    };
  });
}

/**
 * Innsending fra skjemaet.
 *
 * `manual: false` — loggen skal vise ærlig at dette kom fra QR-koden og ikke fra styret i
 * appen. Avviket som eventuelt opprettes arver `orgId` fra OPPGAVEN, ikke fra en kontekst;
 * det er ingen kontekst her.
 */
export async function registrerViaQr(token: string, data: z.infer<typeof qrUtkvittering>) {
  return withoutRls("qr-anonym", async (db) => {
    const rader = await db
      .select({ id: tasks.id, orgId: tasks.orgId, leverandor: vendors.name })
      .from(tasks)
      .leftJoin(vendors, eq(vendors.id, tasks.vendorId))
      .where(and(eq(tasks.qrToken, token), eq(tasks.active, true)))
      .limit(1);

    const oppgave = rader[0];
    if (!oppgave) throw ikkeFunnet("Ugyldig eller inaktiv QR-kode");

    // Uten navn føres leverandørselskapet, som uansett er avtaleparten som svarer for
    // jobben. Loggen skal aldri stå tom for hvem som utførte.
    const utfortAv = data.completedBy?.trim() || oppgave.leverandor || "Ukjent";

    const utkvittering = await opprettUtkvittering(db, oppgave.id, utfortAv, data, {
      manuell: false,
      orgId: oppgave.orgId,
      avvikstittel: "Avvik registrert via QR",
    });

    return { id: utkvittering.id };
  });
}

/**
 * Bilde som dokumentasjon. Lastes opp ETTER registreringen, siden id-en ikke finnes før da.
 *
 * Slår opplastingen feil, står utførelsen igjen uten bilde — og det er riktig vei å feile:
 * jobben ER utført, og skal ikke gå tapt fordi et bilde ikke kom fram.
 */
export async function lastOppQrBilde(token: string, completionId: string, fil: File) {
  return withoutRls("qr-anonym", async (db) => {
    // Utførelsen må høre til NETTOPP den oppgaven tokenet peker på. Uten den koblingen
    // kunne et hvilket som helst gyldig token brukes til å laste opp på en annen kundes
    // utførelse, så lenge man kjente id-en.
    const rader = await db
      .select({ id: completions.id, orgId: tasks.orgId })
      .from(completions)
      .innerJoin(tasks, eq(tasks.id, completions.taskId))
      .where(and(eq(completions.id, completionId), eq(tasks.qrToken, token)))
      .limit(1);

    const utkvittering = rader[0];
    if (!utkvittering) throw ikkeFunnet("Ugyldig QR-kode eller utførelse");

    const antall = await db
      .select({ id: completionPhotos.id })
      .from(completionPhotos)
      .where(eq(completionPhotos.completionId, completionId));
    if (antall.length >= MAKS_BILDER) {
      throw ugyldig(`Maks ${MAKS_BILDER} bilder per utførelse.`);
    }

    // `lagreFil` håndterer filtype, størrelse og kvote. `typer` snevrer inn til bilder —
    // uten den ville det anonyme endepunktet arvet hele den tillatte typelista.
    const lagret = await lagreFil(db, utkvittering.orgId, "completions", fil, {
      typer: BILDETYPER,
    });

    const [rad] = await db
      .insert(completionPhotos)
      .values({
        id: randomUUID(),
        completionId,
        orgId: utkvittering.orgId,
        filename: lagret.filnavn,
        originalName: lagret.originalnavn,
        contentType: lagret.contentType,
        fileSize: lagret.storrelse,
      })
      .returning();
    return rad!;
  });
}

/**
 * Offentlig rutinevisning. Samme modell som utkvitteringen: tokenet er nøkkelen.
 *
 * Rutiner henges opp der de gjelder — brannvarslingssentralen, fyrrommet — slik at den som
 * står der faktisk kan lese hva de skal gjøre. Den er LESEVISNING; det finnes ingenting å
 * sende inn.
 */
export async function hentOffentligRutine(token: string) {
  return withoutRls("qr-anonym", async (db) => {
    const rader = await db
      .select({
        id: routines.id,
        tittel: routines.title,
        beskrivelse: routines.description,
        orgNavn: organizations.name,
        versjon: routines.version,
        sistGjennomgatt: routines.lastReviewedAt,
      })
      .from(routines)
      .innerJoin(organizations, eq(organizations.id, routines.orgId))
      .where(eq(routines.qrToken, token))
      .limit(1);

    const rutine = rader[0];
    if (!rutine) throw ikkeFunnet("Ugyldig QR-kode");

    const steg = await db
      .select({
        id: routineSteps.id,
        tittel: routineSteps.title,
        beskrivelse: routineSteps.description,
        kritisk: routineSteps.isCritical,
        varselType: routineSteps.calloutType,
        varselTekst: routineSteps.calloutText,
      })
      .from(routineSteps)
      .where(eq(routineSteps.routineId, rutine.id))
      .orderBy(asc(routineSteps.order));

    return { ...rutine, steg };
  });
}
