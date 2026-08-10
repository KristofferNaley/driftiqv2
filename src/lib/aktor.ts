/**
 * Den som utfører en handling som blir stående i historikken. **Ingen importer** — leses av
 * både skrivestiene på serveren og av typene klienten ser.
 *
 * ## Hvorfor BEGGE feltene, og aldri bare ett
 *
 * `navn` er protokollen. En utkvittering fra 2024 skal lese likt om ti år: «Kari Nordmann»,
 * selv etter at Kari har byttet etternavn eller er fjernet fra laget. Derfor kopieres navnet
 * inn i raden, og derfor kan det ikke byttes ut med en peker — en journal som skriver seg om
 * når folk gifter seg er ikke dokumentasjon. Det er begrunnelsen bak kommentarene på
 * `completions.completedBy`, `logEntries.createdBy` og `deviationTreatments.createdBy`.
 *
 * `brukerId` er søkenøkkelen. «Hva har JEG gjort» (`lib/aktivitet.ts`) kan ikke bygges på
 * navn: bytter du navn, finner et navneoppslag ingenting, og to personer med samme navn i
 * samme lag finner hverandres rader. Id-en løser begge.
 *
 * De svarer altså på ulike spørsmål, og ingen av dem kan utledes av den andre i ettertid.
 * Samme mønster som `feedbackReports.reportedByUserId` + `reportedByName` og
 * `supportAccessLog.superadminId` + `adminName`, som begge har hatt det fra starten.
 *
 * ## Når `brukerId` er null
 *
 * Ikke en svakhet, men et faktum: QR-skjemaet er anonymt med vilje, og en beboer eller en
 * rørlegger som kvitterer ut på et oppslag i kjelleren har ingen konto. Da står navnet alene,
 * slik det gjorde før — og raden er fortsatt gyldig dokumentasjon.
 */
export type Aktor = {
  navn: string;
  brukerId: string | null;
};

/** Aktøren for en innlogget bruker. Eneste sted `bruker` oversettes til en aktør. */
export const aktorFor = (bruker: { id: string; name: string }): Aktor => ({
  navn: bruker.name,
  brukerId: bruker.id,
});

/** Aktør uten konto — QR-skjemaet og leverandørportalen. Navnet er alt vi har. */
export const anonymAktor = (navn: string): Aktor => ({ navn, brukerId: null });
