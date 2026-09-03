"use client";

import { useEffect, useState } from "react";
import { Feil, Kort, Nokkeltall, Tom, dato, useOrgData } from "@/components/felles";
import { Knapperad, Modal, Tekstfelt, Tekstomrade, useSending } from "@/components/skjema";
import { okonomi, type Eier, type Seksjon } from "@/lib/klient";
import { brokStemmer, brokTekst, isoDato, kroner } from "@/lib/okonomiregler";

/**
 * Eierregisteret — «andelsregisteret» for sameiet: hvem eier hvilken seksjon, med hvilken
 * brøk. Brøken er seksjonens (tinglyst) og redigeres rett i raden; eieren er en person
 * med historikk, og et eierskifte er en egen handling som arkiverer den forrige.
 *
 * Personopplysninger: kun kontoadmin skriver. Lesing for alle med modulen — styret må
 * kunne slå opp hvem som eier seksjon 12.
 */
export default function Eiere({ erAdmin }: { erAdmin: boolean }) {
  const { data, feil, setFeil, laster, last, orgId } = useOrgData((o) => okonomi.eiere(o));
  const [skifte, setSkifte] = useState<Seksjon | null>(null);
  const [historikk, setHistorikk] = useState<Seksjon | null>(null);
  const [sok, setSok] = useState("");

  const seksjoner = (data?.seksjoner ?? []).filter((s) => {
    const q = sok.trim().toLowerCase();
    if (!q) return true;
    return [s.navn, s.andelsnr, s.eier?.name, s.eier?.email].some((v) => v?.toLowerCase().includes(q));
  });

  const brokOk = data ? brokStemmer(data.brokSum) : true;

  return (
    <>
      <Feil melding={feil} />

      {data && (
        <div className="auto-grid">
          <Nokkeltall etikett="Seksjoner" verdi={data.seksjoner.length} />
          <Nokkeltall
            etikett="Uten eier"
            verdi={<span className={data.utenEier > 0 ? "ok-kpi-varsel" : undefined}>{data.utenEier}</span>}
          />
          <Nokkeltall
            etikett="Uten brøk"
            verdi={<span className={data.utenBrok > 0 ? "ok-kpi-varsel" : undefined}>{data.utenBrok}</span>}
          />
          <Nokkeltall
            etikett="Sum brøk"
            verdi={
              <span className="ok-kpi">
                <span className={brokOk ? undefined : "ok-kpi-varsel"}>{data.brokSum.toFixed(3)}</span>
                <span className="ok-kpi-under">{brokOk ? "stemmer (skal være 1)" : "skal være 1,000"}</span>
              </span>
            }
          />
        </div>
      )}

      <Kort
        tittel="Eiere per seksjon"
        handling={
          <input
            className="input"
            placeholder="Søk seksjon eller eier …"
            aria-label="Søk"
            value={sok}
            onChange={(e) => setSok(e.target.value)}
          />
        }
      >
        {laster || !data ? (
          <Tom tekst="Henter …" />
        ) : data.seksjoner.length === 0 ? (
          <Tom tekst="Ingen seksjoner registrert. Leiligheter legges inn under Innstillinger — eiere og brøk kommer hit." />
        ) : seksjoner.length === 0 ? (
          <Tom tekst="Ingen treff." />
        ) : (
          <>
            <p className="ok-tekst">
              Eieropplysningene behandles etter databehandleravtalen med sameiet. Ved eierskifte arkiveres den forrige
              eieren med sluttdato. Hele overtakelsesmåneden faktureres den som eide seksjonen den 1. — kjøper og
              selger gjør opp seg imellom.
            </p>
            <div className="ok-eier-hode" aria-hidden>
              <span>Seksjon</span>
              <span>Eier</span>
              <span className="ok-eier-fra">Eier fra</span>
              <span className="ok-eier-bra">BRA m²</span>
              <span className="ok-eier-brok">Brøk</span>
              <span className="ok-belop-celle ok-eier-sats">Felleskost/mnd</span>
              <span />
            </div>
            {seksjoner.map((s) => (
              <div key={s.unitId} className="ok-eier-rad">
                <div style={{ minWidth: 0 }}>
                  <div className="list-tittel">{s.navn}</div>
                  {(s.oppgang || s.andelsnr) && (
                    <div className="list-meta">
                      {[s.oppgang && `oppg. ${s.oppgang}`, s.andelsnr && `seksjon ${s.andelsnr}`].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </div>
                <div style={{ minWidth: 0 }}>
                  {s.eier ? (
                    <>
                      <div className="list-tittel">{s.eier.name}</div>
                      <div className="list-meta">{[s.eier.email, s.eier.phone].filter(Boolean).join(" · ") || "ingen kontaktinfo"}</div>
                    </>
                  ) : (
                    <span className="badge warn">Ingen eier</span>
                  )}
                </div>
                <span className="ok-eier-fra list-meta">{s.eier ? dato(s.eier.ownerFrom) : "—"}</span>
                <span className="ok-eier-bra list-meta">{s.arealM2 ? Number(s.arealM2).toLocaleString("nb-NO") : "—"}</span>
                <span className="ok-eier-brok">
                  {erAdmin && orgId ? (
                    <BrokFelt
                      seksjon={s}
                      onLagre={async (teller, nevner) => {
                        try {
                          await okonomi.settBrok(orgId, s.unitId, { teller, nevner });
                          await last();
                        } catch (e) {
                          setFeil(e instanceof Error ? e.message : "Kunne ikke lagre brøken");
                        }
                      }}
                    />
                  ) : (
                    <span className="list-meta">{brokTekst({ teller: s.brokTeller, nevner: s.brokNevner })}</span>
                  )}
                </span>
                <span className="ok-belop-celle ok-eier-sats">{s.satsMnd !== null ? kroner(s.satsMnd) : <span className="list-meta">—</span>}</span>
                <span className="ok-linje-handling">
                  {(s.eier || s.antallTidligere > 0) && (
                    <button className="btn btn-ghost" onClick={() => setHistorikk(s)}>
                      {s.antallTidligere > 0 ? `Historikk (${s.antallTidligere + (s.eier ? 1 : 0)})` : "Detaljer"}
                    </button>
                  )}
                  {erAdmin && (
                    <button className="btn btn-ghost" onClick={() => setSkifte(s)}>
                      {s.eier ? "Eierskifte" : "Registrer eier"}
                    </button>
                  )}
                </span>
              </div>
            ))}
            <div className="ok-eier-rad ok-eier-sum" aria-label="Sum">
              <span className="list-tittel">{seksjoner.length} seksjoner</span>
              <span />
              <span className="ok-eier-fra" />
              <span className="ok-eier-bra list-meta">
                {seksjoner.some((s) => s.arealM2) ? seksjoner.reduce((sum, s) => sum + Number(s.arealM2 ?? 0), 0).toLocaleString("nb-NO") : ""}
              </span>
              <span className={`ok-eier-brok${brokOk ? "" : " ok-mangler"}`}>{data.brokSum.toFixed(3)}</span>
              <span className="ok-belop-celle ok-eier-sats">{kroner(data.satsSumMnd)}</span>
              <span />
            </div>
          </>
        )}
      </Kort>

      {skifte && orgId && (
        <EierModal
          seksjon={skifte}
          onLukk={() => setSkifte(null)}
          onLagre={async (d) => {
            await okonomi.registrerEier(orgId, { unitId: skifte.unitId, ...d });
            await last();
          }}
        />
      )}

      {historikk && orgId && (
        <HistorikkModal
          orgId={orgId}
          seksjon={historikk}
          erAdmin={erAdmin}
          onLukk={() => setHistorikk(null)}
          onEndret={last}
        />
      )}
    </>
  );
}

/** Teller/nevner rett i raden. Lagres når begge er fylt ut, eller nulles når begge er tomme. */
function BrokFelt({
  seksjon,
  onLagre,
}: {
  seksjon: Seksjon;
  onLagre: (teller: number | null, nevner: number | null) => Promise<void>;
}) {
  const [teller, setTeller] = useState(seksjon.brokTeller?.toString() ?? "");
  const [nevner, setNevner] = useState(seksjon.brokNevner?.toString() ?? "");
  useEffect(() => {
    setTeller(seksjon.brokTeller?.toString() ?? "");
    setNevner(seksjon.brokNevner?.toString() ?? "");
  }, [seksjon.brokTeller, seksjon.brokNevner]);

  function lagre() {
    const t = teller.trim() === "" ? null : Number(teller);
    const n = nevner.trim() === "" ? null : Number(nevner);
    if ((t === null) !== (n === null)) return; // halvveis utfylt — vent på det andre feltet
    if (t !== null && (!Number.isInteger(t) || !Number.isInteger(n) || n! <= 0 || t < 0)) return;
    if (t === seksjon.brokTeller && n === seksjon.brokNevner) return;
    void onLagre(t, n);
  }

  return (
    <span className="ok-brok">
      <input
        className="input ok-brok-felt"
        inputMode="numeric"
        aria-label={`Brøk teller for ${seksjon.navn}`}
        value={teller}
        onChange={(e) => setTeller(e.target.value)}
        onBlur={lagre}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
      <span className="ok-brok-strek">/</span>
      <input
        className="input ok-brok-felt"
        inputMode="numeric"
        aria-label={`Brøk nevner for ${seksjon.navn}`}
        value={nevner}
        onChange={(e) => setNevner(e.target.value)}
        onBlur={lagre}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
    </span>
  );
}

function EierModal({
  seksjon,
  onLukk,
  onLagre,
}: {
  seksjon: Seksjon;
  onLukk: () => void;
  onLagre: (d: {
    name: string; email: string | null; phone: string | null; invoiceAddress: string | null;
    ownerFrom: string; note: string | null;
  }) => Promise<void>;
}) {
  const [navn, setNavn] = useState("");
  const [epost, setEpost] = useState("");
  const [telefon, setTelefon] = useState("");
  const [adresse, setAdresse] = useState("");
  const [fra, setFra] = useState(isoDato(new Date()));
  const [notat, setNotat] = useState("");
  const { sender, feil, send } = useSending(onLukk);

  return (
    <Modal tittel={seksjon.eier ? `Eierskifte ${seksjon.navn}` : `Registrer eier av ${seksjon.navn}`} onLukk={onLukk}>
      <form
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
        onSubmit={(e) => {
          e.preventDefault();
          void send(() =>
            onLagre({
              name: navn, email: epost.trim() || null, phone: telefon.trim() || null,
              invoiceAddress: adresse.trim() || null, ownerFrom: fra, note: notat.trim() || null,
            }),
          );
        }}
      >
        {seksjon.eier && (
          <p className="ok-tekst">
            {seksjon.eier.name} står som eier fra {dato(seksjon.eier.ownerFrom)} og får sluttdato dagen før den nye
            overtar. Overtakelsesmåneden faktureres i sin helhet den som eier seksjonen den 1. i måneden; linjer som
            alt er laget, blir stående.
          </p>
        )}
        <Tekstfelt etikett="Navn" verdi={navn} onEndre={setNavn} />
        <div className="field-row">
          <Tekstfelt etikett="E-post" verdi={epost} onEndre={setEpost} type="email" notat="Faktura sendes hit når regnskapskoblingen er på" />
          <Tekstfelt etikett="Telefon" verdi={telefon} onEndre={setTelefon} />
        </div>
        <Tekstfelt etikett="Overtar fra" verdi={fra} onEndre={setFra} type="date" />
        <Tekstomrade etikett="Fakturaadresse" verdi={adresse} onEndre={setAdresse} rader={2} plassholder="Bare når den er en annen enn seksjonen (utleier, verge, dødsbo)" />
        <Tekstomrade etikett="Notat" verdi={notat} onEndre={setNotat} rader={2} />
        <Feil melding={feil} />
        <Knapperad onAvbryt={onLukk} sender={sender} sendEtikett={seksjon.eier ? "Gjennomfør eierskifte" : "Registrer"} />
      </form>
    </Modal>
  );
}

function HistorikkModal({
  orgId,
  seksjon,
  erAdmin,
  onLukk,
  onEndret,
}: {
  orgId: string;
  seksjon: Seksjon;
  erAdmin: boolean;
  onLukk: () => void;
  onEndret: () => Promise<void>;
}) {
  const [liste, setListe] = useState<Eier[] | null>(null);
  const [feil, setFeil] = useState<string | null>(null);
  const [rediger, setRediger] = useState<Eier | null>(null);

  async function hent() {
    try {
      setListe(await okonomi.eierhistorikk(orgId, seksjon.unitId));
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke hente historikken");
    }
  }
  useEffect(() => {
    void hent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, seksjon.unitId]);

  async function slett(e: Eier) {
    if (!window.confirm(`Slette registreringen av ${e.name}? Bare for feilregistreringer — et eierskifte gjøres med «Eierskifte».`)) return;
    try {
      await okonomi.slettEier(orgId, e.id);
      await hent();
      await onEndret();
    } catch (err) {
      setFeil(err instanceof Error ? err.message : "Kunne ikke slette");
    }
  }

  return (
    <Modal tittel={`Eiere av ${seksjon.navn}`} onLukk={onLukk}>
      <Feil melding={feil} />
      {!liste ? (
        <Tom tekst="Henter …" />
      ) : liste.length === 0 ? (
        <Tom tekst="Ingen eiere registrert." />
      ) : (
        liste.map((e) => (
          <div key={e.id} className="ok-hist-rad">
            <div style={{ minWidth: 0 }}>
              <div className="list-tittel">
                {e.name} {e.ownerTo === null && <span className="badge ok">Nå</span>}
              </div>
              <div className="list-meta">
                {dato(e.ownerFrom)} – {e.ownerTo ? dato(e.ownerTo) : "…"}
                {e.email && ` · ${e.email}`}
                {e.phone && ` · ${e.phone}`}
              </div>
              {e.invoiceAddress && <div className="list-meta">Faktura: {e.invoiceAddress}</div>}
              {e.note && <div className="list-meta">{e.note}</div>}
            </div>
            {erAdmin && (
              <span className="ok-linje-handling">
                <button className="btn btn-ghost" onClick={() => setRediger(e)}>
                  Rett
                </button>
                <button className="btn btn-ghost" onClick={() => void slett(e)}>
                  Slett
                </button>
              </span>
            )}
          </div>
        ))
      )}

      {rediger && (
        <RettModal
          eier={rediger}
          onLukk={() => setRediger(null)}
          onLagre={async (d) => {
            await okonomi.endreEier(orgId, rediger.id, d);
            await hent();
            await onEndret();
          }}
        />
      )}
    </Modal>
  );
}

/** Retting av kontaktopplysninger — datoene røres ikke; det er eierskiftet som eier dem. */
function RettModal({
  eier,
  onLukk,
  onLagre,
}: {
  eier: Eier;
  onLukk: () => void;
  onLagre: (d: { name: string; email: string | null; phone: string | null; invoiceAddress: string | null; note: string | null }) => Promise<void>;
}) {
  const [navn, setNavn] = useState(eier.name);
  const [epost, setEpost] = useState(eier.email ?? "");
  const [telefon, setTelefon] = useState(eier.phone ?? "");
  const [adresse, setAdresse] = useState(eier.invoiceAddress ?? "");
  const [notat, setNotat] = useState(eier.note ?? "");
  const { sender, feil, send } = useSending(onLukk);
  return (
    <Modal tittel={`Rett opplysninger om ${eier.name}`} onLukk={onLukk}>
      <form
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
        onSubmit={(e) => {
          e.preventDefault();
          void send(() =>
            onLagre({
              name: navn, email: epost.trim() || null, phone: telefon.trim() || null,
              invoiceAddress: adresse.trim() || null, note: notat.trim() || null,
            }),
          );
        }}
      >
        <Tekstfelt etikett="Navn" verdi={navn} onEndre={setNavn} />
        <div className="field-row">
          <Tekstfelt etikett="E-post" verdi={epost} onEndre={setEpost} type="email" />
          <Tekstfelt etikett="Telefon" verdi={telefon} onEndre={setTelefon} />
        </div>
        <Tekstomrade etikett="Fakturaadresse" verdi={adresse} onEndre={setAdresse} rader={2} />
        <Tekstomrade etikett="Notat" verdi={notat} onEndre={setNotat} rader={2} />
        <Feil melding={feil} />
        <Knapperad onAvbryt={onLukk} sender={sender} />
      </form>
    </Modal>
  );
}
