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
  notes: string | null;
  lease: { id: string; tenantName: string; pricePerMonth: number } | null;
};

export type Ventende = {
  id: string;
  name: string;
  requestedType: string;
  requestedAt: string;
  notes: string | null;
};

export const parkering = {
  plasser: (orgId: string) => api.hent<Plass[]>(org(orgId, "/parking/spots")),
  nyPlass: (orgId: string, data: unknown) => api.send<Plass>(org(orgId, "/parking/spots"), data),
  endrePlass: (orgId: string, id: string, data: unknown) =>
    api.endre<Plass>(org(orgId, `/parking/spots/${id}`), data),
  slettPlass: (orgId: string, id: string) => api.slett(org(orgId, `/parking/spots/${id}`)),

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
  lastCompletedAt: string | null; nesteFrist: string | null; forsinket: boolean;
};

export const oppgaver = {
  liste: (o: string) => api.hent<Oppgave[]>(org(o, "/tasks")),
  hent: (o: string, id: string) =>
    api.hent<Oppgave & { sjekkliste: Array<{ id: string; text: string; order: number }>; utkvitteringer: Array<{ id: string; completedAt: string; completedBy: string; notes: string | null; manual: boolean }> }>(org(o, `/tasks/${id}`)),
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
};

export type Kontrakt = {
  id: string; title: string; category: string | null; annualSum: number | null;
  startDate: string | null; endDate: string | null; vendorId: string; vendorName: string | null;
  fileName: string | null; fileOriginalName: string | null; aiReadable: boolean;
  archivedAt: string | null; archiveNote: string | null;
};

export const kontrakter = {
  liste: (o: string, arkiverte?: boolean) =>
    api.hent<Kontrakt[]>(org(o, `/contracts${arkiverte === undefined ? "" : `?arkiverte=${arkiverte}`}`)),
  hent: (o: string, id: string) =>
    api.hent<Kontrakt & { prishistorikk: Array<{ id: string; effectiveDate: string; annualSum: number; note: string | null }> }>(org(o, `/contracts/${id}`)),
  ny: (o: string, d: unknown) => api.send<Kontrakt>(org(o, "/contracts"), d),
  endre: (o: string, id: string, d: unknown) => api.endre<Kontrakt>(org(o, `/contracts/${id}`), d),
  arkiver: (o: string, id: string, d: unknown) => api.send(org(o, `/contracts/${id}/archive`), d),
  gjenopprett: (o: string, id: string) => api.slett(org(o, `/contracts/${id}/archive`)),
  lastOppFil: (o: string, id: string, f: FormData) => api.lastOpp(org(o, `/contracts/${id}/file`), f),
  nyPris: (o: string, id: string, d: unknown) => api.send(org(o, `/contracts/${id}/prices`), d),
};

export type Leverandor = {
  id: string; name: string; active: boolean; relationshipType: string; category: string | null;
  customerNumber: string | null; ehf: boolean; orgNumber: string | null; notes: string | null;
};

export const leverandorer = {
  liste: (o: string) => api.hent<Leverandor[]>(org(o, "/vendors")),
  hent: (o: string, id: string) =>
    api.hent<Leverandor & { kontakter: Array<{ id: string; name: string; role: string | null; email: string | null; phone: string | null; isPrimary: boolean }>; adgang: Array<{ id: string; title: string; status: string; issuedTo: string | null }>; notater: Array<{ id: string; text: string; authorName: string | null; createdAt: string }> }>(org(o, `/vendors/${id}`)),
  ny: (o: string, d: unknown) => api.send<Leverandor>(org(o, "/vendors"), d),
  endre: (o: string, id: string, d: unknown) => api.endre<Leverandor>(org(o, `/vendors/${id}`), d),
  slett: (o: string, id: string) => api.slett(org(o, `/vendors/${id}`)),
  nyKontakt: (o: string, id: string, d: unknown) => api.send(org(o, `/vendors/${id}/contacts`), d),
  nyttNotat: (o: string, id: string, d: unknown) => api.send(org(o, `/vendors/${id}/notes`), d),
};

export type Dokument = {
  id: string; title: string; folder: string; documentDate: string | null;
  originalName: string; fileSize: number | null; aiReadable: boolean;
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
  liste: (o: string) => api.hent<Logglinje[]>(org(o, "/driftslogg")),
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
};

export type Rutine = {
  id: string; title: string; description: string | null; category: string | null;
  responsible: string | null; isCritical: boolean; status: string; version: number;
  lastReviewedAt: string | null; effektivStatus: "utkast" | "aktiv" | "trenger_gjennomgang";
};

export const rutiner = {
  liste: (o: string) => api.hent<Rutine[]>(org(o, "/routines")),
  hent: (o: string, id: string) =>
    api.hent<Rutine & { steg: Array<{ id: string; title: string; description: string | null; isCritical: boolean; calloutType: string | null; calloutText: string | null; kontakt: { name: string; phone: string | null } | null }>; versjoner: Array<{ id: string; versionNumber: number; changedBy: string; changedAt: string }> }>(org(o, `/routines/${id}`)),
  ny: (o: string, d: unknown) => api.send<Rutine>(org(o, "/routines"), d),
  endre: (o: string, id: string, d: unknown) => api.endre<Rutine>(org(o, `/routines/${id}`), d),
  slett: (o: string, id: string) => api.slett(org(o, `/routines/${id}`)),
  markerGjennomgatt: (o: string, id: string) => api.send(org(o, `/routines/${id}/review`), {}),
};

export type IkStatus = {
  aar: number; maalSatt: boolean; ansvarFordelt: boolean; risikoKartlagt: boolean;
  vernerundeGjennomfort: boolean; evaluert: boolean;
};
export type Fare = {
  id: string; title: string; category: string | null; probability: number; consequence: number;
  status: string; owner: string | null; risiko: number; niva: "lav" | "middels" | "hoy";
  tiltak: Array<{ id: string; title: string; status: string; dueDate: string | null }>;
};

export const internkontroll = {
  status: (o: string) => api.hent<IkStatus>(org(o, "/hms/status")),
  maal: (o: string) => api.hent<Array<{ id: string; year: number; goalText: string; approved: boolean }>>(org(o, "/hms/goals")),
  nyttMaal: (o: string, d: unknown) => api.send(org(o, "/hms/goals"), d),
  signer: (o: string, id: string) => api.send(org(o, `/hms/goals/${id}/sign`), {}),
  ansvar: (o: string) => api.hent<Array<{ area: string; personName: string | null; note: string | null }>>(org(o, "/hms/responsibilities")),
  settAnsvar: (o: string, d: unknown) => api.endre(org(o, "/hms/responsibilities"), d),
  farer: (o: string) => api.hent<Fare[]>(org(o, "/hms/hazards")),
  nyFare: (o: string, d: unknown) => api.send<Fare>(org(o, "/hms/hazards"), d),
  nyttTiltak: (o: string, d: unknown) => api.send(org(o, "/hms/actions"), d),
  runder: (o: string) => api.hent<Array<{ id: string; title: string; roundDate: string | null; status: string }>>(org(o, "/hms/rounds")),
  hentRunde: (o: string, id: string) =>
    api.hent<{ id: string; title: string; status: string; punkter: Array<{ id: string; text: string; section: string | null; checked: boolean; notes: string | null }>; deltakere: Array<{ id: string; name: string; role: string | null }>; avvik: Avvik[] }>(org(o, `/hms/rounds/${id}`)),
  nyRunde: (o: string, d: unknown) => api.send<{ id: string }>(org(o, "/hms/rounds"), d),
  kryssAv: (o: string, rid: string, pid: string, d: unknown) => api.endre(org(o, `/hms/rounds/${rid}/items/${pid}`), d),
  fullfor: (o: string, id: string) => api.send(org(o, `/hms/rounds/${id}/complete`), {}),
  evalueringer: (o: string) => api.hent<Array<{ id: string; year: number; conclusion: string | null; evaluatedDate: string | null }>>(org(o, "/hms/evaluations")),
  nyEvaluering: (o: string, d: unknown) => api.send(org(o, "/hms/evaluations"), d),
};

export type Samtale = { id: string; title: string; updatedAt: string };

export const aiRadgiver = {
  samtaler: (o: string) => api.hent<Samtale[]>(org(o, "/ai/conversations")),
  hent: (o: string, id: string) =>
    api.hent<Samtale & { meldinger: Array<{ id: string; role: string; content: string; sources: string | null }> }>(org(o, `/ai/conversations/${id}`)),
  slett: (o: string, id: string) => api.slett(org(o, `/ai/conversations/${id}`)),
  spor: (o: string, d: unknown) =>
    api.send<{ svar: string; kilder: string[]; samtaleId: string }>(org(o, "/ai/ask"), d),
};

export type Enhet = {
  id: string; type: string; navn: string | null; andelsnr: string | null;
  leilighetsnr: string | null; oppgang: string | null; etasje: string | null;
  arealM2: string | null; archivedAt: string | null; apneAvvik: number;
};

export const enheter = {
  liste: (o: string, medArkiverte = false) =>
    api.hent<Enhet[]>(org(o, `/units${medArkiverte ? "?arkiverte=true" : ""}`)),
  ny: (o: string, d: unknown) => api.send<Enhet>(org(o, "/units"), d),
  endre: (o: string, id: string, d: unknown) => api.endre<Enhet>(org(o, `/units/${id}`), d),
  arkiver: (o: string, id: string) => api.slett(org(o, `/units/${id}`)),
};

export type Dashbord = {
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
};

export type OrgInfo = {
  id: string; name: string; slug: string; orgNr: string | null; orgForm: string | null;
  municipality: string | null; unitCount: number | null; enabledModules: string | null;
  buildingInfo: string | null; hasEmployees: boolean;
  lagring: { brukt: number; kvote: number; prosent: number };
};

export const organisasjon = {
  hent: (o: string) => api.hent<OrgInfo>(`/organizations/${o}`),
  endre: (o: string, d: unknown) => api.endre<OrgInfo>(`/organizations/${o}`, d),
  /**
   * Modulvalg — plattformadmin. Blir stående her fordi plattformpanelet skal bruke det;
   * kundens innstillinger gjør det IKKE, og API-et avviser dem uansett.
   */
  settModuler: (o: string, moduler: string[]) => api.endre(`/organizations/${o}/modules`, { moduler }),
};

export type OrgBruker = {
  id: string; name: string; email: string; active: boolean; lastLoginAt: string | null;
  platformRole: string; nivaa: string; title: string | null; harSattPassord: boolean;
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
  egneVarsler: (o: string) => api.hent<{ prefs: Record<string, boolean> }>(org(o, "/users/meg/varsler")),
  settEgneVarsler: (o: string, prefs: Record<string, boolean>) =>
    api.endre(org(o, "/users/meg/varsler"), { prefs }),
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
  /** Org-er du har aktivt support-innsyn i. Tom for vanlige brukere. */
  supportOrger: string[];
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  organisasjoner: Array<{ id: string; name: string; nivaa: string; enabledModules: string | null }>;
};

export const meg = {
  hent: () => api.hent<MegSvar>("/meg"),
  /** Navn og telefon. E-post kan ikke endres her — se kommentaren i api/meg/route.ts. */
  lagre: (d: { name?: string; phone?: string | null }) => api.endre<MegSvar>("/meg", d),
};
