"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Knapperad, Modal, Tekstfelt, useSending } from "@/components/skjema";
import { api } from "@/lib/klient";
import { formatOrgNr } from "@/lib/orgnr";
import { Felt, type Detalj, type Org } from "./deler";

/**
 * Organisasjon-kortet: identitet, størrelse, kontakt og tilknytning i ETT kort med én
 * Rediger. Før var det to kort med hver sin knapp, og det samme feltet sto på to sider.
 */
export function OrgKort({ detalj, onRediger }: { detalj: Detalj; onRediger: () => void }) {
  const { org } = detalj;
  return (
    <div className="pf-kort">
      <div className="pf-kort-hode">
        <span>Organisasjon</span>
        <button className="btn btn-ghost" onClick={onRediger}>
          Rediger
        </button>
      </div>
      <div className="pf-kort-kropp">
        <div className="pf-seksjon">Identitet</div>
        <Felt etikett="Navn" verdi={org.name} />
        <Felt etikett="Org.nr" verdi={formatOrgNr(org.orgNr)} />
        <Felt etikett="Selskapsform" verdi={org.orgForm} />
        <Felt etikett="Kommune" verdi={org.municipality} />

        <div className="pf-seksjon">Størrelse</div>
        <Felt etikett="Andeler" verdi={org.unitCount?.toString()} />
        <Felt etikett="Enheter i Enhetsregisteret" verdi={String(detalj.onboarding.tellinger.enheter)} />
        <Felt etikett="Har ansatte" verdi={org.hasEmployees ? "Ja" : "Nei"} />

        <div className="pf-seksjon">Kontakt</div>
        <Felt etikett="E-post" verdi={org.contactEmail} />
        <Felt etikett="Telefon" verdi={org.phone} />
        <Felt etikett="Nettside" verdi={org.website} />

        <div className="pf-seksjon">Tilknytning</div>
        <Felt etikett="Boligbyggelag" verdi={tilknytning(org)} />
        <Felt etikett="Forretningsfører" verdi={forretningsforer(org)} />
      </div>
    </div>
  );
}

function tilknytning(org: Org): string | null {
  if (org.affiliationType === "tilknyttet") return org.bblNavn ?? "Tilknyttet";
  if (org.affiliationType === "frittstaende") return "Frittstående";
  return null;
}

function forretningsforer(org: Org): string | null {
  if (org.managerType === "selvadministrert") return "Selvadministrert";
  if (org.managerType === "bbl") return org.managerBblNavn ?? "Boligbyggelag";
  if (org.managerType === "ekstern") return org.managerName ?? "Ekstern";
  return null;
}

// ── Slett kunde ─────────────────────────────────────────────────────────────────────────


/**
 * Sletter kunden og alt den eier, for godt — se `lib/kundesletting.ts`. Knappen er død til
 * kunden er satt inaktiv: slettingen skal være andre steg av to, ikke ett feiltrykk.
 */
export function SlettKunde({ org }: { org: Org }) {
  const router = useRouter();
  const [apen, setApen] = useState(false);
  const [navn, setNavn] = useState("");
  const { sender, feil, send } = useSending(() => router.push("/plattform/kunder"));

  return (
    <div className="pf-kort">
      <div className="pf-kort-hode">
        <span>Slett kunde</span>
        <button
          className="btn btn-ghost fjern-knapp"
          disabled={org.active}
          onClick={() => {
            setNavn("");
            setApen(true);
          }}
        >
          Slett kunde …
        </button>
      </div>
      <div className="pf-kort-kropp">
        <p className="field-note">
          {org.active
            ? "Kunden må settes inaktiv før den kan slettes (Rediger → Aktiv kunde)."
            : "Sletter organisasjonen, alle data og filer, og brukerkontoer som ikke er med i andre kunder. Kan ikke angres."}
        </p>
      </div>

      {apen && (
        <Modal tittel="Slett kunde" onLukk={() => setApen(false)} bredde={460}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(() => api.send(`/plattform/kunder/${org.id}/slett`, { bekreftNavn: navn.trim() }));
            }}
          >
            {feil && <div className="feilmelding">{feil}</div>}
            <p style={{ fontSize: "var(--fs-sm)", lineHeight: 1.6 }}>
              Dette sletter <strong>{org.name}</strong> for godt: oppgaver, avvik, dokumenter,
              filer, oppslagstavle, integrasjoner, abonnement, innsynslogg og
              hendelseslogg. Brukerkontoer som bare finnes for denne kunden slettes også.
            </p>
            <div className="tips-stripe" style={{ margin: "12px 0" }}>
              <span style={{ fontSize: "var(--fs-sm)", lineHeight: 1.6 }}>
                ⚠ Det finnes ingen angre og ingen sikkerhetskopi i appen.
              </span>
            </div>
            <Tekstfelt
              etikett="Skriv kundens navn for å bekrefte"
              verdi={navn}
              onEndre={setNavn}
            />
            <Knapperad
              onAvbryt={() => setApen(false)}
              sendEtikett="Slett kunden"
              farlig
              sender={sender}
              deaktivert={navn.trim() !== org.name.trim()}
            />
          </form>
        </Modal>
      )}
    </div>
  );
}

// ── Rediger organisasjon ────────────────────────────────────────────────────────────────

/**
 * Ett skjema for hele Organisasjon-kortet. Tilknytningen sendes med i samme kall og lagres i
 * samme transaksjon (se `endreKunde`), så skjemaet aldri står halvt lagret.
 */
export function OrgModal({
  org,
  onLukk,
  onLagret,
}: {
  org: Org;
  onLukk: () => void;
  onLagret: () => void;
}) {
  const [navn, setNavn] = useState(org.name);
  const [orgNr, setOrgNr] = useState(org.orgNr ?? "");
  const [orgForm, setOrgForm] = useState(org.orgForm ?? "");
  const [kommune, setKommune] = useState(org.municipality ?? "");
  const [andeler, setAndeler] = useState(org.unitCount?.toString() ?? "");
  const [epost, setEpost] = useState(org.contactEmail ?? "");
  const [telefon, setTelefon] = useState(org.phone ?? "");
  const [nettside, setNettside] = useState(org.website ?? "");
  const [ansatte, setAnsatte] = useState(org.hasEmployees);
  const [aktiv, setAktiv] = useState(org.active);
  const [demo, setDemo] = useState(org.demo);
  // Kvoten lagres i bytes, men ingen tenker i bytes. Skjemaet er i GB.
  const [kvoteGb, setKvoteGb] = useState(
    org.storageQuota ? String(org.storageQuota / 1024 / 1024 / 1024) : "",
  );
  const [tilknyttet, setTilknyttet] = useState(org.affiliationType ?? "");
  const [bblId, setBblId] = useState(org.bblId ?? "");
  const [forer, setForer] = useState(org.managerType ?? "");
  const [forerBblId, setForerBblId] = useState(org.managerBblId ?? "");
  const [forerNavn, setForerNavn] = useState(org.managerName ?? "");
  const [forerOrgNr, setForerOrgNr] = useState(org.managerOrgNr ?? "");
  const [lag, setLag] = useState<Array<{ id: string; name: string }>>([]);
  const { sender, feil, send } = useSending(onLagret);

  useEffect(() => {
    api
      .hent<Array<{ id: string; name: string }>>("/plattform/bbl-valg")
      .then(setLag)
      .catch(() => setLag([]));
  }, []);

  return (
    <Modal tittel="Rediger organisasjon" onLukk={onLukk} bredde={560}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(() =>
            api.endre(`/plattform/kunder/${org.id}`, {
              name: navn.trim(),
              orgNr: orgNr.trim() || null,
              orgForm: orgForm.trim() || null,
              municipality: kommune.trim() || null,
              unitCount: andeler.trim() ? parseInt(andeler, 10) : null,
              contactEmail: epost.trim() || null,
              phone: telefon.trim() || null,
              website: nettside.trim() || null,
              hasEmployees: ansatte,
              active: aktiv,
              demo,
              storageQuota: kvoteGb.trim()
                ? Math.round(parseFloat(kvoteGb) * 1024 * 1024 * 1024)
                : null,
              tilknytning: {
                affiliationType: tilknyttet || null,
                bblId: bblId || null,
                managerType: forer || null,
                managerBblId: forerBblId || null,
                managerName: forerNavn.trim() || null,
                managerOrgNr: forerOrgNr.trim() || null,
              },
            }),
          );
        }}
      >
        {feil && <div className="feilmelding">{feil}</div>}

        <div className="pf-seksjon">Identitet</div>
        <Tekstfelt etikett="Navn *" verdi={navn} onEndre={setNavn} />
        <Tekstfelt etikett="Organisasjonsnummer" verdi={orgNr} onEndre={setOrgNr} />
        <Tekstfelt etikett="Selskapsform" verdi={orgForm} onEndre={setOrgForm} />
        <Tekstfelt etikett="Kommune" verdi={kommune} onEndre={setKommune} />

        <div className="pf-seksjon">Størrelse</div>
        <Tekstfelt
          etikett="Antall andeler"
          type="number"
          verdi={andeler}
          onEndre={setAndeler}
          notat="Grunnlaget for grunnpakkeprisen. Endres den, må abonnementet lagres på nytt."
        />
        <label className="pf-modul-valg">
          <input type="checkbox" checked={ansatte} onChange={(e) => setAnsatte(e.target.checked)} />
          <span style={{ minWidth: 0 }}>
            <span className="pf-navn">Har ansatte</span>
            <span className="pf-under">
              Avgjør hvilke lover internkontrollen må dekke. Med ansatte slår
              arbeidsmiljøloven inn.
            </span>
          </span>
        </label>

        <div className="pf-seksjon">Kontakt</div>
        <Tekstfelt etikett="E-post" type="email" verdi={epost} onEndre={setEpost} />
        <Tekstfelt etikett="Telefon" verdi={telefon} onEndre={setTelefon} />
        <Tekstfelt etikett="Nettside" verdi={nettside} onEndre={setNettside} />

        <div className="pf-seksjon">Tilknytning</div>
        <div className="field">
          <label className="field-label" htmlFor="tilknytning">
            Tilknytning
          </label>
          <select
            id="tilknytning"
            className="input"
            value={tilknyttet}
            onChange={(e) => setTilknyttet(e.target.value)}
          >
            <option value="">Ikke satt</option>
            <option value="frittstaende">Frittstående</option>
            <option value="tilknyttet">Tilknyttet et boligbyggelag</option>
          </select>
        </div>

        {tilknyttet === "tilknyttet" && (
          <div className="field">
            <label className="field-label" htmlFor="bbl">
              Boligbyggelag
            </label>
            <select id="bbl" className="input" value={bblId} onChange={(e) => setBblId(e.target.value)}>
              <option value="">Velg lag …</option>
              {lag.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="field">
          <label className="field-label" htmlFor="forer">
            Forretningsfører
          </label>
          <select id="forer" className="input" value={forer} onChange={(e) => setForer(e.target.value)}>
            <option value="">Ikke satt</option>
            <option value="selvadministrert">Selvadministrert</option>
            <option value="bbl">Et boligbyggelag</option>
            <option value="ekstern">Eksternt byrå</option>
          </select>
          <div className="field-note">
            Et separat forhold fra tilknytningen. De faller ofte sammen, men et frittstående
            lag kan ha et regnskapsbyrå, og et tilknyttet lag kan være selvadministrert.
          </div>
        </div>

        {forer === "bbl" && (
          <div className="field">
            <label className="field-label" htmlFor="forer-bbl">
              Hvilket lag
            </label>
            <select
              id="forer-bbl"
              className="input"
              value={forerBblId}
              onChange={(e) => setForerBblId(e.target.value)}
            >
              <option value="">Velg lag …</option>
              {lag.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {forer === "ekstern" && (
          <>
            <Tekstfelt etikett="Navn på byrå" verdi={forerNavn} onEndre={setForerNavn} />
            <Tekstfelt etikett="Org.nr" verdi={forerOrgNr} onEndre={setForerOrgNr} />
          </>
        )}

        <div className="pf-seksjon">Kundeforhold</div>
        <Tekstfelt
          etikett="Lagringskvote (GB)"
          type="number"
          verdi={kvoteGb}
          onEndre={setKvoteGb}
          notat="Tomt = standardkvoten."
        />
        <label className="pf-modul-valg">
          <input type="checkbox" checked={aktiv} onChange={(e) => setAktiv(e.target.checked)} />
          <span className="pf-navn">Aktiv kunde</span>
        </label>
        <label className="pf-modul-valg">
          <input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} />
          <span style={{ minWidth: 0 }}>
            <span className="pf-navn">Demo- eller testkunde</span>
            <span className="pf-under">Holdes utenfor statistikken og forretningstallene.</span>
          </span>
        </label>

        <Knapperad onAvbryt={onLukk} sender={sender} deaktivert={!navn.trim()} />
      </form>
    </Modal>
  );
}
