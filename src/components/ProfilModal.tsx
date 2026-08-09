"use client";

import { useEffect, useState } from "react";
import { authKlient, signOut } from "@/lib/auth-klient";
import { meg } from "@/lib/klient";
import { VARSLER, VARSEL_STANDARD } from "@/lib/varselvalg";
import { brukere } from "@/lib/klient";
import { Feil } from "./felles";
import { Knapperad, Modal, Tekstfelt } from "./skjema";

/**
 * «Min profil» — egne opplysninger, egne varsler, passord og utlogging.
 *
 * ## Hvorfor varslene ligger BÅDE her og under Brukere
 *
 * Valgene er personlige, så de hører hjemme på ens egen profil. Samtidig kan en kontoadmin
 * sette dem for andre fra brukermodalen — ellers måtte et styremedlem be om hjelp for å skru
 * av en e-post de ikke vil ha. To innganger, samme lagring: `user_org_memberships`.
 */
export default function ProfilModal({
  orgId,
  onLukk,
  onLagret,
}: {
  orgId: string | null;
  onLukk: () => void;
  onLagret: () => void;
}) {
  const [navn, setNavn] = useState("");
  const [epost, setEpost] = useState("");
  const [telefon, setTelefon] = useState("");
  const [varsler, setVarsler] = useState<Record<string, boolean> | null>(null);
  const [feil, setFeil] = useState<string | null>(null);
  const [lagret, setLagret] = useState(false);
  const [lagrer, setLagrer] = useState(false);
  const [viserPassord, setViserPassord] = useState(false);

  useEffect(() => {
    meg
      .hent()
      .then((b) => {
        setNavn(b.name);
        setEpost(b.email);
        setTelefon(b.phone ?? "");
      })
      .catch((e) => setFeil(e instanceof Error ? e.message : "Kunne ikke hente profilen"));
  }, []);

  useEffect(() => {
    if (!orgId) return;
    brukere
      .egneVarsler(orgId)
      .then((r) => setVarsler({ ...VARSEL_STANDARD, ...r.prefs }))
      .catch(() => setVarsler({ ...VARSEL_STANDARD }));
  }, [orgId]);

  async function lagre() {
    setLagrer(true);
    setFeil(null);
    try {
      await meg.lagre({ name: navn.trim(), phone: telefon.trim() || null });
      if (orgId && varsler) await brukere.settEgneVarsler(orgId, varsler);
      setLagret(true);
      onLagret();
      setTimeout(() => setLagret(false), 2000);
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke lagre");
    } finally {
      setLagrer(false);
    }
  }

  /**
   * Utlogging går gjennom Better Auth, ikke ved å tømme `localStorage` som i v1.
   * Forskjellen er at sesjonen faktisk avsluttes på SERVEREN — et token som bare er slettet
   * i nettleseren er fortsatt gyldig til det utløper av seg selv.
   */
  async function loggUt() {
    await signOut();
    window.location.href = "/logg-inn";
  }

  if (viserPassord) {
    return <ByttPassord onTilbake={() => setViserPassord(false)} onLukk={onLukk} />;
  }

  return (
    <Modal tittel="Min profil" onLukk={onLukk}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void lagre();
        }}
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
      >
        <Feil melding={feil} />

        <Tekstfelt etikett="Navn" verdi={navn} onEndre={setNavn} />
        <Tekstfelt
          etikett="E-postadresse"
          verdi={epost}
          onEndre={setEpost}
          laast
          notat="E-posten er innloggingsnavnet ditt og kan ikke endres her."
        />
        <Tekstfelt etikett="Telefon" verdi={telefon} onEndre={setTelefon} plassholder="Valgfritt" />

        {orgId && (
          <div className="field">
            <span className="field-label">Mine varsler</span>
            <div className="field-note" style={{ marginBottom: "6px" }}>
              Hvilke e-poster du får fra denne organisasjonen. Sitter du i flere lag, settes de
              hver for seg.
            </div>
            {varsler === null ? (
              <div className="field-note">Henter …</div>
            ) : (
              VARSLER.map((v) => (
                <label key={v.nokkel} className="varsel-valg">
                  <input
                    type="checkbox"
                    checked={varsler[v.nokkel] ?? false}
                    onChange={(e) => setVarsler({ ...varsler, [v.nokkel]: e.target.checked })}
                  />
                  <span style={{ minWidth: 0 }}>
                    <span className="varsel-navn">{v.etikett}</span>
                    <span className="varsel-desc">{v.beskrivelse}</span>
                  </span>
                </label>
              ))
            )}
          </div>
        )}

        <div className="field">
          <span className="field-label">Konto</span>
          <button type="button" className="btn btn-ghost profil-handling" onClick={() => setViserPassord(true)}>
            Bytt passord
          </button>
          <button type="button" className="btn btn-ghost profil-handling fjern-knapp" onClick={() => void loggUt()}>
            Logg ut
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "4px" }}>
          {lagret && (
            <span style={{ marginRight: "auto", fontSize: "var(--fs-label)", color: "var(--accent2)" }}>
              Lagret.
            </span>
          )}
          <button type="button" className="btn btn-ghost" style={{ marginLeft: lagret ? undefined : "auto" }} onClick={onLukk}>
            Lukk
          </button>
          <button className="btn btn-primary" disabled={lagrer || !navn.trim()}>
            {lagrer ? "Lagrer …" : "Lagre"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Passordbytte gjennom Better Auth.
 *
 * `revokeOtherSessions` er satt: bytter du passord fordi du tror noen andre har det, hjelper
 * det lite om deres innlogging fortsetter å virke.
 */
function ByttPassord({ onTilbake, onLukk }: { onTilbake: () => void; onLukk: () => void }) {
  const [naa, setNaa] = useState("");
  const [nytt, setNytt] = useState("");
  const [gjenta, setGjenta] = useState("");
  const [feil, setFeil] = useState<string | null>(null);
  const [lagrer, setLagrer] = useState(false);

  async function bytt() {
    if (nytt.length < 8) return setFeil("Passordet må være minst 8 tegn.");
    if (nytt !== gjenta) return setFeil("De to passordene er ikke like.");
    setLagrer(true);
    setFeil(null);
    const svar = await authKlient.changePassword({
      currentPassword: naa,
      newPassword: nytt,
      revokeOtherSessions: true,
    });
    setLagrer(false);
    if (svar.error) {
      setFeil(svar.error.message ?? "Kunne ikke bytte passord. Stemmer det nåværende passordet?");
      return;
    }
    onLukk();
  }

  return (
    <Modal tittel="Bytt passord" onLukk={onLukk} bredde={420}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void bytt();
        }}
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
      >
        <Feil melding={feil} />
        <Tekstfelt etikett="Nåværende passord" type="password" verdi={naa} onEndre={setNaa} />
        <Tekstfelt
          etikett="Nytt passord"
          type="password"
          verdi={nytt}
          onEndre={setNytt}
          notat="Minst 8 tegn."
        />
        <Tekstfelt etikett="Gjenta nytt passord" type="password" verdi={gjenta} onEndre={setGjenta} />
        <div className="field-note">
          Andre enheter du er logget inn på blir logget ut. Bytter du passord fordi noen andre
          kan ha hatt det, er det nettopp det du vil.
        </div>
        <Knapperad
          onAvbryt={onTilbake}
          avbrytEtikett="Tilbake"
          sendEtikett="Bytt passord"
          sender={lagrer}
          deaktivert={!naa || !nytt || !gjenta}
        />
      </form>
    </Modal>
  );
}
