/**
 * Utskriftsarkene — A4-oppslag som henges opp der jobben gjøres.
 *
 * Arket ER bæreren av QR-koden: det henger i heismaskinrommet eller ved sprinklersentralen,
 * og montøren skanner koden på det. Derfor er dette og den anonyme QR-flyten samme feature
 * sett fra to sider.
 *
 * ## QR-koden genereres på SERVEREN, som en data-URI
 *
 * v1 hentet den fra et innlogget `qr.png`-endepunkt og måtte derfor laste bildet som en blob
 * FØR utskrift — ellers printet Ctrl+P en tom rute. Hele den koreografien forsvinner når
 * bildet ligger i svaret: er arket rendret, er koden der.
 */

import { and, asc, eq } from "drizzle-orm";
import QRCode from "qrcode";
import type { Db } from "../db/client";
import { organizations } from "../db/schema/organizations";
import { routines, routineSteps } from "../db/schema/rutiner";
import { taskChecklistItems, tasks } from "../db/schema/tasks";
import { units } from "../db/schema/units";
import { users } from "../db/schema/users";
import { vendors } from "../db/schema/vendors";
import { ikkeFunnet, ugyldig } from "./api";
import { APP_URL } from "./epost";

/**
 * QR-koden som en data-URI.
 *
 * `errorCorrectionLevel: "M"` er ikke standardvalget uten grunn: arket henger i et teknisk
 * rom og blir støvete, krøllete og delvis dekket. M tåler ~15 % skade — L (biblioteksstandard)
 * tåler 7 %, og en kode som ikke lar seg skanne er verre enn en litt tettere kode.
 */
async function qrDataUri(url: string): Promise<string> {
  return QRCode.toDataURL(url, {
    errorCorrectionLevel: "M",
    margin: 1,
    // Fysisk trykk: for få piksler gir en uskarp kode på papir.
    width: 512,
    color: { dark: "#0d1b2a", light: "#ffffff" },
  });
}

export async function hentOppgaveark(db: Db, orgId: string, taskId: string) {
  const rader = await db
    .select({
      tittel: tasks.title,
      beskrivelse: tasks.description,
      frekvens: tasks.frequency,
      sted: tasks.location,
      enhetNavn: units.navn,
      qrToken: tasks.qrToken,
      leverandor: vendors.name,
      orgNavn: organizations.name,
      ansvarligNavn: users.name,
      ansvarligEpost: users.email,
      ansvarligTelefon: users.phone,
    })
    .from(tasks)
    .innerJoin(organizations, eq(organizations.id, tasks.orgId))
    .leftJoin(vendors, eq(vendors.id, tasks.vendorId))
    .leftJoin(units, eq(units.id, tasks.unitId))
    .leftJoin(users, eq(users.id, tasks.responsibleUserId))
    .where(and(eq(tasks.id, taskId), eq(tasks.orgId, orgId)))
    .limit(1);

  const rad = rader[0];
  if (!rad) throw ikkeFunnet("Oppgave");
  // Uten token er det ingenting å skanne, og arket ville vært et papir med en tom rute.
  if (!rad.qrToken) throw ugyldig("Oppgaven har ingen QR-kode ennå.");

  const sjekkliste = await db
    .select({ id: taskChecklistItems.id, text: taskChecklistItems.text })
    .from(taskChecklistItems)
    .where(eq(taskChecklistItems.taskId, taskId))
    .orderBy(asc(taskChecklistItems.order));

  const skannUrl = `${APP_URL}/kvittering/${rad.qrToken}`;
  return {
    ...rad,
    sted: rad.enhetNavn ?? rad.sted,
    sjekkliste,
    skannUrl,
    qr: await qrDataUri(skannUrl),
  };
}

export async function hentRutineark(db: Db, orgId: string, routineId: string) {
  const rader = await db
    .select({
      tittel: routines.title,
      beskrivelse: routines.description,
      kategori: routines.category,
      kritisk: routines.isCritical,
      versjon: routines.version,
      qrToken: routines.qrToken,
      orgNavn: organizations.name,
    })
    .from(routines)
    .innerJoin(organizations, eq(organizations.id, routines.orgId))
    .where(and(eq(routines.id, routineId), eq(routines.orgId, orgId)))
    .limit(1);

  const rad = rader[0];
  if (!rad) throw ikkeFunnet("Rutine");
  if (!rad.qrToken) throw ugyldig("Rutinen har ingen QR-kode ennå.");

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
    .where(eq(routineSteps.routineId, routineId))
    .orderBy(asc(routineSteps.order));

  const skannUrl = `${APP_URL}/rutine/${rad.qrToken}`;
  return { ...rad, steg, skannUrl, qr: await qrDataUri(skannUrl) };
}
