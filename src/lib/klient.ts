/**
 * ENESTE sted for API-kall fra klienten. Ingen `fetch` i sider eller komponenter.
 *
 * Samme regel som v1s `frontend/src/api.js`, og av samme grunn: token, 401-håndtering og
 * feilmeldinger skal skje ett sted. Ligger de i komponentene, oppdager du først i
 * produksjon at én av dem glemte å lese `detail` og viste «[object Object]».
 *
 * v2 trenger ikke Authorization-headeren v1 satte — Better Auth bruker sesjonscookie, og
 * `credentials: "same-origin"` er nok. Til gjengjeld MÅ 401 håndteres her, siden ingen
 * enkeltside vet hva den skal gjøre med en utløpt sesjon.
 */

import type { MinAktivitet } from "./aktivitetsslag";
import type { Driftslogg } from "./driftsloggslag";

export class ApiKlientFeil extends Error {
  constructor(
    readonly status: number,
    melding: string,
  ) {
    super(melding);
    this.name = "ApiKlientFeil";
  }
}

async function request<T>(sti: string, init: RequestInit = {}): Promise<T> {
  const svar = await fetch(`/api${sti}`, {
    ...init,
    credentials: "same-origin",
    headers: {
      ...(init.body instanceof FormData ? {} : { "content-type": "application/json" }),
      ...init.headers,
    },
  });

  if (svar.status === 401) {
    // Sesjonen er borte. Send brukeren til innlogging med retur-sti, i stedet for å la
    // siden stå og vise en feilmelding de ikke kan gjøre noe med.
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/logg-inn")) {
      window.location.href = `/logg-inn?retur=${encodeURIComponent(window.location.pathname)}`;
    }
    throw new ApiKlientFeil(401, "Ikke innlogget");
  }

  if (svar.status === 204) return undefined as T;

  const data = await svar.json().catch(() => null);
  if (!svar.ok) {
    // API-et svarer alltid `{ detail }` — se `tilSvar()` i lib/api.ts.
    throw new ApiKlientFeil(svar.status, data?.detail ?? "Noe gikk galt");
  }
  return data as T;
}

const org = (orgId: string, sti: string) => `/organizations/${orgId}${sti}`;

export const api = {
  hent: <T>(sti: string) => request<T>(sti),
  send: <T>(sti: string, kropp: unknown) =>
    request<T>(sti, { method: "POST", body: JSON.stringify(kropp) }),
  endre: <T>(sti: string, kropp: unknown) =>
    request<T>(sti, { method: "PUT", body: JSON.stringify(kropp) }),
  /** Delvis endring (PATCH) — for enkeltfelter der PUT allerede betyr noe annet. */
  lapp: <T>(sti: string, kropp: unknown) =>
    request<T>(sti, { method: "PATCH", body: JSON.stringify(kropp) }),
  slett: (sti: string) => request<void>(sti, { method: "DELETE" }),
  /** Filopplasting. `content-type` settes IKKE — nettleseren må sette grensen selv. */
  lastOpp: <T>(sti: string, form: FormData) => request<T>(sti, { method: "POST", body: form }),
};

// ---------------------------------------------------------------------------------------
// Endepunktene, per modul. Sidene kaller disse, aldri `api` direkte med en håndskrevet sti.
// ---------------------------------------------------------------------------------------

export type Plass = {
  id: string;
  number: string;
  areaLabel: string | null;
  ownershipType: string;
  spotType: string;
  status: string;
  holderName: string | null;
  unitLabel: string | null;
  hasCharger: boolean;
  chargerLabel: string | null;
  notes: string | null;
  lease: { id: string; tenantName: string; pricePerMonth: number; endDate: string | null } | null;
};

export type Ventende = {
  id: string;
  name: string;
  unitLabel: string | null;
  requestedType: string;
  requestedAt: string;
  notes: string | null;
};

export type Parkeringsavtale = {
  id: string;
  spotId: string;
  tenantName: string;
  pricePerMonth: number;
  startDate: string | null;
  endDate: string | null;
  noticePeriodMonths: number | null;
  powerBilling: string | null;
  endedAt: string | null;
};

export const parkering = {
  plasser: (orgId: string) => api.hent<Plass[]>(org(orgId, "/parking/spots")),
  nyPlass: (orgId: string, data: unknown) => api.send<Plass>(org(orgId, "/parking/spots"), data),
  nySerie: (orgId: string, data: unknown) => api.send<Plass[]>(org(orgId, "/parking/spots/serie"), data),
  endrePlass: (orgId: string, id: string, data: unknown) =>
    api.endre<Plass>(org(orgId, `/parking/spots/${id}`), data),
  slettPlass: (orgId: string, id: string) => api.slett(org(orgId, `/parking/spots/${id}`)),

  avtaler: (orgId: string) => api.hent<Parkeringsavtale[]>(org(orgId, "/parking/leases")),
  nyAvtale: (orgId: string, data: unknown) => api.send(org(orgId, "/parking/leases"), data),
  avsluttAvtale: (orgId: string, id: string) => api.slett(org(orgId, `/parking/leases/${id}`)),

  venteliste: (orgId: string) => api.hent<Ventende[]>(org(orgId, "/parking/waitlist")),
  nyVentende: (orgId: string, data: unknown) => api.send<Ventende>(org(orgId, "/parking/waitlist"), data),
  slettVentende: (orgId: string, id: string) => api.slett(org(orgId, `/parking/waitlist/${id}`)),
};

export type Oppgave = {
  id: string; title: string; description: string | null; location: string | null;
  frequency: string; startDate: string | null; dueDate: string | null; active: boolean;
  qrToken: string | null; vendorId: string; vendorName: string | null; unitNavn: string | null;
  ansvarligNavn: string | null;
  /**
   * `unitId`, `responsibleUserId` og `showOnArshjul` manglet i typen selv om API-et alltid
   * har sendt dem — ruta returnerer hele oppgaveraden. Følgen var at redigeringsskjemaet ikke
   * kunne forhåndsfylle sted og ansvarlig: verdiene var i svaret, men usynlige for TypeScript.
   * Samme glipp som er dokumentert på `Dokument` lenger ned.
   */
  unitId: string | null; responsibleUserId: string | null; showOnArshjul: boolean;
  lastCompletedAt: string | null; nesteFrist: string | null; forsinket: boolean;
};

/**
 * Ett SJEKKPUNKT slik det sto ved én utførelse — kopien i `completion_checklist_results`.
 *
 * `itemId` peker på malpunktet og er nullbar: malen kan endres, og punkter som er tatt bort
 * settes til null. `text` er derfor protokollen, id-en er søkenøkkelen — samme skille som for
 * aktørene i `lib/aktor.ts`.
 */
export type Utkvitteringspunkt = {
  id: string;
  itemId: string | null;
  text: string;
  checked: boolean;
  order: number;
};

/** Bildet leverandøren tok på stedet. Filen hentes fra utkvitteringens egen filrute. */
export type Utkvitteringsbilde = {
  id: string;
  originalName: string;
  contentType: string | null;
  fileSize: number | null;
};

export type Utkvittering = {
  id: string;
  completedAt: string;
  completedBy: string;
  notes: string | null;
  manual: boolean;
  punkter: Utkvitteringspunkt[];
  bilder: Utkvitteringsbilde[];
};

export type OppgaveMedHistorikk = Oppgave & {
  sjekkliste: Array<{ id: string; text: string; order: number }>;
  utkvitteringer: Utkvittering[];
};

export const oppgaver = {
  liste: (o: string) => api.hent<Oppgave[]>(org(o, "/tasks")),
  hent: (o: string, id: string) => api.hent<OppgaveMedHistorikk>(org(o, `/tasks/${id}`)),
  ny: (o: string, d: unknown) => api.send<Oppgave>(org(o, "/tasks"), d),
  endre: (o: string, id: string, d: unknown) => api.endre<Oppgave>(org(o, `/tasks/${id}`), d),
  deaktiver: (o: string, id: string) => api.slett(org(o, `/tasks/${id}`)),
  kvitterUt: (o: string, id: string, d: unknown) => api.send(org(o, `/tasks/${id}/completions`), d),
  settSjekkliste: (o: string, id: string, d: unknown) => api.endre(org(o, `/tasks/${id}/checklist`), d),
};

export type Avvik = {
  id: string; number: number | null; title: string; description: string | null;
  status: string; severity: string | null; assignedTo: string | null; dueDate: string | null;
  reportedBy: string; reportedAt: string; category: string | null; unitNavn: string | null;
};

export type AvvikDetalj = Avvik & {
  responsibleUserId: string | null;
  vendorId: string | null;
  taskId: string | null;
  unitId: string | null;
  vendorNavn: string | null;
  taskTittel: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolutionNotes: string | null;
  behandlinger: Array<{ id: string; text: string; createdBy: string; createdAt: string }>;
  vedlegg: Array<{
    id: string; originalName: string; contentType: string | null; fileSize: number | null;
    uploadedBy: string; uploadedAt: string; treatmentId: string | null;
  }>;
  logg: Array<{ id: string; event: string; changedBy: string; changedAt: string }>;
};

export type AvvikSok = {
  side?: number;
  sok?: string;
  kategori?: string;
  unitId?: string;
  lukkede?: boolean;
  sorter?: string;
  retning?: "asc" | "desc";
};

export type AvvikSvar = {
  items: Avvik[];
  total: number;
  side: number;
  sider: number;
  stats: {
    ytd: number; ytdIFjor: number; ytdEndring: number | null;
    ny: number; underBehandling: number; lukket: number; mine: number;
  };
  kategorier: string | null;
};

export const avvik = {
  /** Liste + nøkkeltall + kategorier i ett kall — se kommentaren på GET-ruta. */
  liste: (o: string, sok: AvvikSok = {}) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sok)) {
      if (v !== undefined && v !== "" && v !== null) p.set(k, String(v));
    }
    return api.hent<AvvikSvar>(org(o, `/deviations?${p.toString()}`));
  },
  hent: (o: string, id: string) =>
    api.hent<AvvikDetalj>(org(o, `/deviations/${id}`)),
  meld: (o: string, d: unknown) => api.send<Avvik>(org(o, "/deviations"), d),
  endre: (o: string, id: string, d: unknown) => api.endre<Avvik>(org(o, `/deviations/${id}`), d),
  lukk: (o: string, id: string, d: unknown) => api.send(org(o, `/deviations/${id}/close`), d),
  behandle: (o: string, id: string, d: unknown) => api.send(org(o, `/deviations/${id}/treatments`), d),
  lastOppVedlegg: (o: string, id: string, f: FormData) =>
    api.lastOpp(org(o, `/deviations/${id}/vedlegg`), f),
  slettVedlegg: (o: string, id: string, vId: string) =>
    api.slett(org(o, `/deviations/${id}/vedlegg/${vId}`)),
};

export type Kontrakt = {
  id: string; title: string; category: string | null; annualSum: number | null;
  startDate: string | null; endDate: string | null; vendorId: string; vendorName: string | null;
  fileName: string | null; fileOriginalName: string | null; aiReadable: boolean;
  archivedAt: string | null; archiveNote: string | null;
  // API-et returnerer hele raden; uten disse i typen kunne ikke redigeringsskjemaet
  // forhåndsfylle notat og kontaktperson — samme glipp som er dokumentert på `Dokument`.
  notes: string | null; contactName: string | null; contactEmail: string | null;
  contactPhone: string | null; predecessorId: string | null;
};

export const kontrakter = {
  liste: (o: string, arkiverte?: boolean) =>
    api.hent<Kontrakt[]>(org(o, `/contracts${arkiverte === undefined ? "" : `?arkiverte=${arkiverte}`}`)),
  hent: (o: string, id: string) =>
    api.hent<Kontrakt & { prishistorikk: Array<{ id: string; effectiveDate: string; annualSum: number; note: string | null }> }>(org(o, `/contracts/${id}`)),
  ny: (o: string, d: unknown) => api.send<Kontrakt>(org(o, "/contracts"), d),
  endre: (o: string, id: string, d: unknown) => api.endre<Kontrakt>(org(o, `/contracts/${id}`), d),
  slett: (o: string, id: string) => api.slett(org(o, `/contracts/${id}`)),
  arkiver: (o: string, id: string, d: unknown) => api.send(org(o, `/contracts/${id}/archive`), d),
  gjenopprett: (o: string, id: string) => api.slett(org(o, `/contracts/${id}/archive`)),
  lastOppFil: (o: string, id: string, f: FormData) => api.lastOpp(org(o, `/contracts/${id}/file`), f),
  slettFil: (o: string, id: string) => api.slett(org(o, `/contracts/${id}/file`)),
  nyPris: (o: string, id: string, d: unknown) => api.send(org(o, `/contracts/${id}/prices`), d),
  slettPris: (o: string, id: string, prisId: string) =>
    api.slett(org(o, `/contracts/${id}/prices/${prisId}`)),
};

export type Leverandor = {
  id: string; name: string; active: boolean; relationshipType: string; category: string | null;
  customerNumber: string | null; ehf: boolean; orgNumber: string | null; notes: string | null;
};

/** Lista bærer oversiktsfeltene — detaljhentingen (`hent`) har dem ikke. */
export type LeverandorIListe = Leverandor & {
  primaryContactName: string | null;
  antallKontrakter: number;
  antallOppgaver: number;
};

export const leverandorer = {
  liste: (o: string) => api.hent<LeverandorIListe[]>(org(o, "/vendors")),
  hent: (o: string, id: string) =>
    api.hent<Leverandor & { kontakter: Array<{ id: string; name: string; role: string | null; email: string | null; phone: string | null; isPrimary: boolean }>; adgang: Array<{ id: string; title: string; status: string; issuedTo: string | null; areas: string | null; issuedAt: string | null }>; notater: Array<{ id: string; text: string; authorName: string | null; createdAt: string }> }>(org(o, `/vendors/${id}`)),
  ny: (o: string, d: unknown) => api.send<Leverandor>(org(o, "/vendors"), d),
  endre: (o: string, id: string, d: unknown) => api.endre<Leverandor>(org(o, `/vendors/${id}`), d),
  slett: (o: string, id: string) => api.slett(org(o, `/vendors/${id}`)),
  nyKontakt: (o: string, id: string, d: unknown) => api.send(org(o, `/vendors/${id}/contacts`), d),
  endreKontakt: (o: string, id: string, kontaktId: string, d: unknown) =>
    api.endre(org(o, `/vendors/${id}/contacts/${kontaktId}`), d),
  slettKontakt: (o: string, id: string, kontaktId: string) =>
    api.slett(org(o, `/vendors/${id}/contacts/${kontaktId}`)),
  nyAdgang: (o: string, id: string, d: unknown) => api.send(org(o, `/vendors/${id}/access-items`), d),
  endreAdgang: (o: string, id: string, itemId: string, d: unknown) =>
    api.endre(org(o, `/vendors/${id}/access-items/${itemId}`), d),
  slettAdgang: (o: string, id: string, itemId: string) =>
    api.slett(org(o, `/vendors/${id}/access-items/${itemId}`)),
  nyttNotat: (o: string, id: string, d: unknown) => api.send(org(o, `/vendors/${id}/notes`), d),
  slettNotat: (o: string, id: string, notatId: string) =>
    api.slett(org(o, `/vendors/${id}/notes/${notatId}`)),
  /**
   * Sender QR-informasjonen til leverandøren. Mottakeren valideres SERVERSIDE mot
   * kontaktpersonene — se `sendQrInfo`. Svaret bekrefter hvilken adresse som fikk den.
   */
  sendQrInfo: (o: string, id: string, d: { emne: string; tekst: string; til: string }) =>
    api.send<{ sendt: true; til: string }>(org(o, `/vendors/${id}/qr-info`), d),
};

export type Dokument = {
  id: string; title: string; folder: string; documentDate: string | null;
  originalName: string; fileSize: number | null; aiReadable: boolean;
  // API-et returnerer hele raden; disse manglet i typen og gjorde at kallsteder som
  // trengte filikon eller opplastingsdato ikke kompilerte.
  contentType: string; uploadedAt: string; description: string | null;
};
export type Mappe = { id: string; name: string; icon: string; parentId: string | null };

export const dokumenter = {
  liste: (o: string, mappe?: string) =>
    api.hent<Dokument[]>(org(o, `/documents${mappe ? `?mappe=${encodeURIComponent(mappe)}` : ""}`)),
  lastOpp: (o: string, f: FormData) => api.lastOpp<Dokument>(org(o, "/documents"), f),
  endre: (o: string, id: string, d: unknown) => api.endre<Dokument>(org(o, `/documents/${id}`), d),
  slett: (o: string, id: string) => api.slett(org(o, `/documents/${id}`)),
  mapper: (o: string) => api.hent<Mappe[]>(org(o, "/document-folders")),
  nyMappe: (o: string, d: unknown) => api.send<Mappe>(org(o, "/document-folders"), d),
  slettMappe: (o: string, id: string) => api.slett(org(o, `/document-folders/${id}`)),
  endreMappe: (o: string, id: string, d: unknown) =>
    api.endre<Mappe>(org(o, `/document-folders/${id}`), d),
  oversikt: (o: string) => api.hent<Arkivoversikt>(org(o, "/documents/oversikt")),
};

export type ArkivDok = {
  id: string; title: string; folder: string; fileSize: number | null;
  originalName: string; contentType: string; documentDate: string | null; uploadedAt: string;
};

export type Arkivoversikt = {
  faste: Array<{ nokkel: string; antall: number; antallUndermapper: number }>;
  egne: Array<Mappe & { antall: number; antallUndermapper: number }>;
  speil: {
    vedlikehold: { antall: number; antallDeler: number };
    kontrakter: { antall: number; antallLeverandorer: number };
  };
  anbefalt: Array<{ mappe: string; tittel: string; hint?: string; ok: boolean }>;
  lagring: { brukt: number; kvote: number; prosent: number };
  nylig: ArkivDok[];
  antallTotalt: number;
};

export type Bygningsdel = {
  id: string; name: string; icon: string; category: string | null; conditionGrade: string | null;
  installedYear: number | null; nextActionYear: number | null; estimatedCost: number | null;
  warrantyExpires: string | null; vendorName: string | null;
  garanti: "aktiv" | "utløpt" | "ukjent"; fdv: { fylt: number; av: number; prosent: number };
};

export const vedlikehold = {
  elementer: (o: string) => api.hent<Bygningsdel[]>(org(o, "/maintenance/elements")),
  hent: (o: string, id: string) =>
    api.hent<Bygningsdel & { dokumenter: Array<{ id: string; fdvType: string; title: string }>; historikk: Array<{ id: string; serviceDate: string; title: string; performedBy: string | null }>; antallEnhetsarbeider: number }>(org(o, `/maintenance/elements/${id}`)),
  nyttElement: (o: string, d: unknown) => api.send<Bygningsdel>(org(o, "/maintenance/elements"), d),
  nyService: (o: string, id: string, d: unknown) => api.send(org(o, `/maintenance/elements/${id}/services`), d),
  lastOppFdv: (o: string, id: string, f: FormData) => api.lastOpp(org(o, `/maintenance/elements/${id}/documents`), f),
  arbeider: (o: string) => api.hent<Array<{ id: string; unitLabel: string; title: string; workDate: string; workType: string; paidBy: string; cost: number | null; vendorName: string | null }>>(org(o, "/maintenance/unit-works")),
  nyttArbeid: (o: string, d: unknown) => api.send(org(o, "/maintenance/unit-works"), d),
};

export type Logglinje = {
  id: string; title: string; description: string | null; entryDate: string;
  createdBy: string; vendorName: string | null;
};

export const driftslogg = {
  /** Den samlede tidslinja — fem kilder flettet på serveren. Typen bor i driftsloggslag.ts. */
  liste: (o: string) => api.hent<Driftslogg>(org(o, "/driftslogg")),
  ny: (o: string, d: unknown) => api.send<Logglinje>(org(o, "/driftslogg"), d),
  slett: (o: string, id: string) => api.slett(org(o, `/driftslogg/${id}`)),
};

export type Hendelse = {
  id: string; title: string; description: string | null; category: string;
  startDate: string | null; eventDate: string; isRecurring: boolean;
};

export const arshjul = {
  liste: (o: string) => api.hent<Hendelse[]>(org(o, "/annual-events")),
  ny: (o: string, d: unknown) => api.send<Hendelse>(org(o, "/annual-events"), d),
  endre: (o: string, id: string, d: unknown) => api.endre<Hendelse>(org(o, `/annual-events/${id}`), d),
  slett: (o: string, id: string) => api.slett(org(o, `/annual-events/${id}`)),
  hjul: (o: string, aar: number) => api.hent<Arshjulsdata>(org(o, `/arshjul/hjul?aar=${aar}`)),
};

export type Hjulhendelse = {
  id: string; tittel: string; under: string;
  kategori: "oppgave" | "dugnad" | "budsjett" | "frist" | "hms" | "annet";
  dato: string; startDato: string | null;
  kilde: "manuell" | "oppgaver" | "internkontroll";
  gjentas: boolean;
};

export type Arshjulsdata = {
  aar: number;
  hendelser: Hjulhendelse[];
  oppgavevalg: Array<{
    id: string; tittel: string; frekvens: string; leverandor: string | null; vises: boolean;
  }>;
};

export type Rutine = {
  id: string; title: string; description: string | null; category: string | null;
  responsible: string | null; appliesTo: string | null; isCritical: boolean;
  reviewIntervalMonths: number | null; status: string; version: number;
  lastReviewedAt: string | null;
  vendorId: string | null; contractId: string | null; documentId: string | null;
  taskId: string | null; internkontrollNote: string | null;
  effektivStatus: "utkast" | "aktiv" | "trenger_gjennomgang";
};

export const rutiner = {
  liste: (o: string) => api.hent<Rutine[]>(org(o, "/routines")),
  hent: (o: string, id: string) =>
    api.hent<Rutine & { steg: Array<{ id: string; title: string; description: string | null; isCritical: boolean; calloutType: string | null; calloutText: string | null; kontakt: { name: string; phone: string | null } | null }>; versjoner: Array<{ id: string; versionNumber: number; changedBy: string; changedAt: string }> }>(org(o, `/routines/${id}`)),
  ny: (o: string, d: unknown) => api.send<Rutine>(org(o, "/routines"), d),
  endre: (o: string, id: string, d: unknown) => api.endre<Rutine>(org(o, `/routines/${id}`), d),
  /** Fryser dagens kladd som versjon i historikken og setter status publisert. */
  publiser: (o: string, id: string) => api.send<Rutine>(org(o, `/routines/${id}/publiser`), {}),
  slett: (o: string, id: string) => api.slett(org(o, `/routines/${id}`)),
  markerGjennomgatt: (o: string, id: string) => api.send(org(o, `/routines/${id}/review`), {}),
};

export type IkStatus = {
  aar: number; maalSatt: boolean; ansvarFordelt: boolean; risikoKartlagt: boolean;
  vernerundeGjennomfort: boolean; evaluert: boolean;
};
export type Fare = {
  id: string; title: string; category: string | null; description: string | null;
  /** null = ikke vurdert — seedede farer starter slik til noen tar stilling. */
  probability: number | null; consequence: number | null;
  status: string; owner: string | null;
  /** null = løpende drift; ellers prosjektet vurderingen hører til. */
  context: string | null;
  lastAssessedAt: string | null;
  /** Aldri vurdert, eller vurderingen er over tolv måneder gammel. */
  trengerVurdering: boolean;
  risiko: number | null; niva: "lav" | "middels" | "hoy" | null;
  tiltak: Array<{ id: string; title: string; status: string; dueDate: string | null; owner: string | null }>;
};

export type HmsMal = {
  id: string; templateType: string; name: string; description: string | null; isDefault: boolean;
};

export type IkOversikt = {
  kpi: { registrerte: number; hoyRisiko: number; forfalteTiltak: number; handtert: number };
  sisteGjennomgang: {
    id: string; reviewDate: string; participants: string | null;
    fordeling: { lav: number; middels: number; hoy: number; uvurdert: number };
    utenTiltak: number;
    perOmrade: Array<{ omrade: string; antall: number }>;
  } | null;
  oppfolging: { risikoerUtenTiltak: number; apneAvvik: number; avvikFraRunder: number };
  frister: Array<{ tittel: string; dato: string | null; status: "fullfort" | "neste" }>;
  aktivitet: Array<{ dato: string; tekst: string }>;
};

export type Gjennomgang = {
  id: string; context: string | null; reviewDate: string;
  participants: string | null; conclusion: string | null; createdAt: string;
  antallFarer: number;
};

export type GjennomgangDetalj = Omit<Gjennomgang, "antallFarer"> & {
  punkter: Array<{
    id: string; title: string; category: string | null; description: string | null;
    probability: number | null; consequence: number | null;
    status: string; owner: string | null; actions: string | null;
    risiko: number | null; niva: "lav" | "middels" | "hoy" | null;
  }>;
};

export type Sjekkliste = {
  id: string; name: string; description: string | null; antallPunkter: number;
};

export type SjekklisteDetalj = {
  id: string; name: string; description: string | null;
  punkter: Array<{ id: string; text: string; section: string | null; order: number }>;
};

export type Rundepunkt = {
  id: string; text: string; section: string | null;
  /** ok | avvik | ikke_aktuelt | null = ubesvart. */
  status: string | null;
  checked: boolean; notes: string | null;
};

export type Runde = {
  id: string; title: string; status: string; roundDate: string | null; dueDate: string | null;
  notes: string | null;
  punkter: Rundepunkt[];
  deltakere: Array<{ id: string; name: string; role: string | null }>;
  /** Runde-endepunktet leverer hele avviksraden — koblingen til punktet er med. */
  avvik: Array<Avvik & { roundItemId: string | null }>;
};

export const internkontroll = {
  status: (o: string) => api.hent<IkStatus>(org(o, "/hms/status")),
  maal: (o: string) => api.hent<Array<{ id: string; year: number; goalText: string; approved: boolean }>>(org(o, "/hms/goals")),
  nyttMaal: (o: string, d: unknown) => api.send(org(o, "/hms/goals"), d),
  signer: (o: string, id: string) => api.send(org(o, `/hms/goals/${id}/sign`), {}),
  ansvar: (o: string) => api.hent<Array<{ area: string; personName: string | null; note: string | null }>>(org(o, "/hms/responsibilities")),
  settAnsvar: (o: string, d: unknown) => api.endre(org(o, "/hms/responsibilities"), d),
  maler: (o: string, type: string) => api.hent<HmsMal[]>(org(o, `/hms/maler?type=${encodeURIComponent(type)}`)),
  farer: (o: string) => api.hent<Fare[]>(org(o, "/hms/hazards")),
  nyFare: (o: string, d: unknown) => api.send<Fare>(org(o, "/hms/hazards"), d),
  endreFare: (o: string, id: string, d: unknown) => api.endre<Fare>(org(o, `/hms/hazards/${id}`), d),
  slettFare: (o: string, id: string) => api.slett(org(o, `/hms/hazards/${id}`)),
  seedFarer: (o: string, templateId: string) =>
    api.send<{ opprettet: number; hoppetOver: number }>(org(o, "/hms/hazards/seed"), { templateId }),
  nyttTiltak: (o: string, d: unknown) => api.send(org(o, "/hms/actions"), d),
  endreTiltak: (o: string, id: string, d: unknown) => api.endre(org(o, `/hms/actions/${id}`), d),
  slettTiltak: (o: string, id: string) => api.slett(org(o, `/hms/actions/${id}`)),
  oversikt: (o: string) => api.hent<IkOversikt>(org(o, "/hms/oversikt")),
  gjennomganger: (o: string) => api.hent<Gjennomgang[]>(org(o, "/hms/risk-reviews")),
  hentGjennomgang: (o: string, id: string) => api.hent<GjennomgangDetalj>(org(o, `/hms/risk-reviews/${id}`)),
  nyGjennomgang: (o: string, d: unknown) => api.send<GjennomgangDetalj>(org(o, "/hms/risk-reviews"), d),
  sjekklister: (o: string) => api.hent<Sjekkliste[]>(org(o, "/hms/checklists")),
  hentSjekkliste: (o: string, id: string) => api.hent<SjekklisteDetalj>(org(o, `/hms/checklists/${id}`)),
  nySjekkliste: (o: string, d: unknown) => api.send<SjekklisteDetalj>(org(o, "/hms/checklists"), d),
  endreSjekkliste: (o: string, id: string, d: unknown) => api.endre(org(o, `/hms/checklists/${id}`), d),
  slettSjekkliste: (o: string, id: string) => api.slett(org(o, `/hms/checklists/${id}`)),
  nyttSjekklistepunkt: (o: string, id: string, d: unknown) => api.send(org(o, `/hms/checklists/${id}/items`), d),
  endreSjekklistepunkt: (o: string, id: string, pid: string, d: unknown) => api.endre(org(o, `/hms/checklists/${id}/items/${pid}`), d),
  slettSjekklistepunkt: (o: string, id: string, pid: string) => api.slett(org(o, `/hms/checklists/${id}/items/${pid}`)),
  runder: (o: string) =>
    api.hent<Array<{ id: string; title: string; roundDate: string | null; dueDate: string | null; status: string; checklistName: string | null }>>(org(o, "/hms/rounds")),
  hentRunde: (o: string, id: string) => api.hent<Runde>(org(o, `/hms/rounds/${id}`)),
  nyRunde: (o: string, d: unknown) => api.send<{ id: string }>(org(o, "/hms/rounds"), d),
  slettRunde: (o: string, id: string) => api.slett(org(o, `/hms/rounds/${id}`)),
  kryssAv: (o: string, rid: string, pid: string, d: unknown) => api.endre(org(o, `/hms/rounds/${rid}/items/${pid}`), d),
  nyttPunkt: (o: string, rid: string, d: unknown) => api.send<Rundepunkt>(org(o, `/hms/rounds/${rid}/items`), d),
  slettPunkt: (o: string, rid: string, pid: string) => api.slett(org(o, `/hms/rounds/${rid}/items/${pid}`)),
  nyDeltaker: (o: string, rid: string, d: unknown) => api.send(org(o, `/hms/rounds/${rid}/participants`), d),
  slettDeltaker: (o: string, rid: string, did: string) => api.slett(org(o, `/hms/rounds/${rid}/participants/${did}`)),
  fullfor: (o: string, id: string) => api.send(org(o, `/hms/rounds/${id}/complete`), {}),
  evalueringer: (o: string) => api.hent<Array<{ id: string; year: number; conclusion: string | null; evaluatedDate: string | null }>>(org(o, "/hms/evaluations")),
  nyEvaluering: (o: string, d: unknown) => api.send(org(o, "/hms/evaluations"), d),
};

export type Samtale = { id: string; title: string; updatedAt: string };

/** Inngangskortene på rådgiversiden. Speiler `AiKort` i lib/ai.ts — regnes av serveren. */
export type AiKort = {
  antall: number; enhet: string; tittel: string; detalj: string;
  sporsmal: string; tone: "rod" | "gul" | "gronn";
};

export const aiRadgiver = {
  samtaler: (o: string) => api.hent<Samtale[]>(org(o, "/ai/conversations")),
  hent: (o: string, id: string) =>
    api.hent<Samtale & { meldinger: Array<{ id: string; role: string; content: string; sources: string | null }> }>(org(o, `/ai/conversations/${id}`)),
  slett: (o: string, id: string) => api.slett(org(o, `/ai/conversations/${id}`)),
  spor: (o: string, d: unknown) =>
    api.send<{ svar: string; kilder: string[]; samtaleId: string }>(org(o, "/ai/ask"), d),
  oversikt: (o: string) => api.hent<AiKort[]>(org(o, "/ai/oversikt")),
};

export type Enhet = {
  id: string; type: string; navn: string | null; andelsnr: string | null;
  leilighetsnr: string | null; oppgang: string | null; etasje: string | null;
  arealM2: string | null; archivedAt: string | null; apneAvvik: number; antallAvvik: number;
};

export type Adressetreff = {
  adressetekst: string | null; nummer: number | null; bokstav: string;
  postnummer: string | null; poststed: string | null; kommunenavn: string | null;
  bruksenhetsnummer: string[];
};

export const enheter = {
  liste: (o: string, medArkiverte = false) =>
    api.hent<Enhet[]>(org(o, `/units${medArkiverte ? "?arkiverte=true" : ""}`)),
  ny: (o: string, d: unknown) => api.send<Enhet>(org(o, "/units"), d),
  endre: (o: string, id: string, d: unknown) => api.endre<Enhet>(org(o, `/units/${id}`), d),
  arkiver: (o: string, id: string) => api.slett(org(o, `/units/${id}`)),
  adressesok: (o: string, adresse: string) =>
    api.hent<Adressetreff[]>(org(o, `/units/adressesok?adresse=${encodeURIComponent(adresse)}`)),
  importer: (o: string, rader: unknown) =>
    api.send<{ opprettet: number; hoppetOver: number }>(org(o, "/units/import"), { rader }),
};

export type Dashbord = {
  banner: boolean;
  moduler: Record<string, boolean>;
  kpi: { oppgaver: number | null; aJour: number | null; forsinket: number | null; apneAvvik: number | null };
  oppfolging: Array<{ slag: string; alvor: "hoy" | "middels" | "lav"; tekst: string; detalj: string; sti: string }>;
  frister: Array<{ dato: string; navn: string; kilde: string }>;
  oppgaveliste: Array<{ id: string; title: string; vendorName: string | null; nesteFrist: string | null; forsinket: boolean }> | null;
  avviksliste: Array<{ id: string; number: number | null; title: string; status: string; severity: string | null }> | null;
  utlopende: Array<{ id: string; title: string; vendorName: string | null; endDate: string | null }> | null;
  tilstand: Array<{ tg: string; antall: number }> | null;
  parkering: { totalt: number; ledige: number; utleid: number } | null;
  rutinerTilRevisjon: Array<{ id: string; title: string; lastReviewedAt: string | null }> | null;
  aktivitet: Array<{ id: string; title: string; entryDate: string; createdBy: string }> | null;
  antallDokumenter: number | null;
  leverandorer: { aktive: number; inaktive: number } | null;
};

export const dashbord = {
  hent: (o: string) => api.hent<Dashbord>(org(o, "/dashboard")),
  /** Widget-oppsettet til den innloggede, i denne org-en. `null` = ikke tilpasset. */
  oppsett: (o: string) =>
    api.hent<Array<{ nokkel: string; storrelse: "s" | "m" | "l" }> | null>(
      org(o, "/dashboard/oppsett"),
    ),
  settOppsett: (o: string, widgets: Array<{ nokkel: string; storrelse: "s" | "m" | "l" }> | null) =>
    api.endre(org(o, "/dashboard/oppsett"), { widgets }),
};

export type OrgInfo = {
  id: string; name: string; slug: string; orgNr: string | null; orgForm: string | null;
  /** Kundens egne avvikskategorier som JSON, eller null for standardsettet. */
  deviationCategories: string | null;
  municipality: string | null; unitCount: number | null; enabledModules: string | null;
  buildingInfo: string | null; hasEmployees: boolean;
  bannerFileName: string | null; bannerOriginalName: string | null;
  lagring: { brukt: number; kvote: number; prosent: number };
};

export const organisasjon = {
  hent: (o: string) => api.hent<OrgInfo>(`/organizations/${o}`),
  endre: (o: string, d: unknown) => api.endre<OrgInfo>(`/organizations/${o}`, d),
  lastOppBanner: (o: string, f: FormData) => api.lastOpp<OrgInfo>(`/organizations/${o}/banner`, f),
  fjernBanner: (o: string) => api.slett(`/organizations/${o}/banner`),
  /**
   * Modulvalg — plattformadmin. Blir stående her fordi plattformpanelet skal bruke det;
   * kundens innstillinger gjør det IKKE, og API-et avviser dem uansett.
   */
  settKategorier: (o: string, kategorier: Array<{ verdi?: string; etikett: string; aktiv: boolean }>) =>
    api.endre<{ kategorier: Array<{ verdi: string; etikett: string; aktiv?: boolean }> }>(
      `/organizations/${o}/avvikskategorier`,
      { kategorier },
    ),
  settModuler: (o: string, moduler: string[]) => api.endre(`/organizations/${o}/modules`, { moduler }),
};

export type OrgBruker = {
  id: string; name: string; email: string; active: boolean; lastLoginAt: string | null;
  platformRole: string; nivaa: string; title: string | null; harSattPassord: boolean;
  tofaktor: boolean;
};

export const brukere = {
  liste: (o: string) => api.hent<OrgBruker[]>(org(o, "/users")),
  inviter: (o: string, d: unknown) => api.send(org(o, "/users"), d),
  endre: (o: string, id: string, d: unknown) => api.endre(org(o, `/users/${id}`), d),
  fjern: (o: string, id: string) => api.slett(org(o, `/users/${id}`)),
  // Varslene ligger på medlemskapet, ikke på kontoen — samme person kan sitte i flere lag
  // og vil sjelden ha samme oppsett i alle.
  varsler: (o: string, id: string) => api.hent<{ prefs: Record<string, boolean> }>(org(o, `/users/${id}/varsler`)),
  settVarsler: (o: string, id: string, prefs: Record<string, boolean>) =>
    api.endre(org(o, `/users/${id}/varsler`), { prefs }),
  /** Sender oppsett-/tilbakestillingslenken på nytt. */
  sendOppsett: (o: string, id: string) => api.send(org(o, `/users/${id}/oppsett-epost`), {}),
  /** Nullstiller tofaktor for en ANNEN bruker — de setter den opp på nytt selv. Se lib/brukere.ts. */
  resettTofaktor: (o: string, id: string) => api.slett(org(o, `/users/${id}/tofaktor`)),
  egneVarsler: (o: string) => api.hent<{ prefs: Record<string, boolean> }>(org(o, "/users/meg/varsler")),
  settEgneVarsler: (o: string, prefs: Record<string, boolean>) =>
    api.endre(org(o, "/users/meg/varsler"), { prefs }),
  /** Egen aktivitet på tvers av modulene. Ingen `[brukerId]`-variant — se kommentaren på ruta. */
  egenAktivitet: (o: string) => api.hent<MinAktivitet>(org(o, "/users/meg/aktivitet")),
  // Typen kommer fra `lib/aktivitetsslag.ts`, ikke fra `lib/aktivitet.ts`: sistnevnte
  // importerer databaseklienten. Importen er `type`-only og forsvinner ved kompilering, men
  // fila den peker på skal uansett være ren — se kommentaren der.
};

export type StyreSvar = {
  status: "ok" | "mangler-orgnr" | "ingen-svar";
  orgNr: string | null;
  styre: Array<{ navn: string; rolle: string }>;
};

/** Enhetsregisteret. Kallet gjøres av API-et, ikke av nettleseren — se lib/brreg.ts. */
export const brreg = {
  styre: (o: string) => api.hent<StyreSvar>(org(o, "/brreg/styre")),
};

export type MegSvar = {
  /** Domenet plattformpanelet ligger på, når vertene er delt. Ellers `null`. */
  adminVert: string | null;
  /** Org-er du har aktivt support-innsyn i. Tom for vanlige brukere. */
  supportOrger: string[];
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  /** Bekreftet tofaktor. Settes av Better Auth først når første kode er godkjent. */
  twoFactorEnabled: boolean;
  organisasjoner: Array<{
    id: string; name: string; nivaa: string;
    /** Vervet i DENNE org-en — «Styreleder». Null når det ikke er fylt ut. */
    tittel: string | null;
    enabledModules: string | null;
  }>;
};

export const navtall = {
  hent: (o: string) =>
    api.hent<{ forsinkedeOppgaver: number; apneAvvik: number }>(org(o, "/navtall")),
};

export const meg = {
  hent: () => api.hent<MegSvar>("/meg"),
  /** Navn og telefon. E-post kan ikke endres her — se kommentaren i api/meg/route.ts. */
  lagre: (d: { name?: string; phone?: string | null }) => api.endre<MegSvar>("/meg", d),
};
