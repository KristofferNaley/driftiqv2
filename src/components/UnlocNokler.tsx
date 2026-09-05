"use client";

import { useCallback, useEffect, useState } from "react";
import { Smartphone } from "lucide-react";
import { Feil, Rad, Tom, dato, datoTid } from "@/components/felles";
import { Knapperad, Modal, Nedtrekk, Tekstfelt, Tekstomrade, useSending } from "@/components/skjema";
import { unloc, type UnlocLaas, type UnlocNokkel, type UnlocNokkelState } from "@/lib/klient";
import { visTelefon } from "@/lib/unloc";

/**
 * Fanen «Digitale nøkler» på leverandørkortet (docs/unloc.md). Lister nøklene styret har
 * delt ut via Unloc — hver med hvem som ga den, til hvem, når og hvor lenge — og lar
 * redigerere dele ut og kalle tilbake. Tilstanden friskes opp fra Unloc ved hver åpning.
 *
 * Komponenten eier sin egen modal; `onUndermodal` sier fra til leverandørmodalen så
 * Escape lukker skjemaet og ikke hele kortet. Fjernbar: én fane og én import i
 * `LeverandorDetaljModal.tsx`.
 */

export const NOKKEL_TILSTAND: Record<UnlocNokkelState, { etikett: string; merke: string }> = {
  creating: { etikett: "Opprettes", merke: "info" },
  scheduled: { etikett: "Planlagt", merke: "info" },
  active: { etikett: "Aktiv", merke: "ok" },
  inactive: { etikett: "Utenfor tidsrom", merke: "warn" },
  expired: { etikett: "Utløpt", merke: "muted" },
  revoked: { etikett: "Tilbakekalt", merke: "muted" },
  error: { etikett: "Feil hos Unloc", merke: "danger" },
};

const LEVENDE: ReadonlySet<UnlocNokkelState> = new Set(["creating", "scheduled", "active", "inactive"]);

export default function UnlocNokler({
  orgId,
  vendorId,
  kanRedigere,
  kontakter,
  onUndermodal,
}: {
  orgId: string;
  vendorId: string;
  kanRedigere: boolean;
  /** Leverandørens kontaktpersoner — forhåndsutfyller navn og nummer i skjemaet. */
  kontakter: ReadonlyArray<{ id: string; name: string; phone: string | null }>;
  onUndermodal: (apen: boolean) => void;
}) {
  type Svar = Awaited<ReturnType<typeof unloc.nokler>>;
  const [data, setData] = useState<Svar | null>(null);
  const [feil, setFeil] = useState<string | null>(null);
  const [skjema, setSkjema] = useState(false);
  const [kaller, setKaller] = useState<string | null>(null);

  const last = useCallback(async () => {
    try {
      setData(await unloc.nokler(orgId, vendorId));
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke hente nøklene");
    }
  }, [orgId, vendorId]);

  useEffect(() => {
    setData(null);
    setFeil(null);
    void last();
  }, [last]);

  function apneSkjema(apen: boolean) {
    setSkjema(apen);
    onUndermodal(apen);
  }

  async function kallTilbake(n: UnlocNokkel) {
    if (!window.confirm(`Kalle tilbake nøkkelen til «${n.lockName}» fra ${n.holderName}? Den slutter å virke med en gang.`)) return;
    setKaller(n.id);
    setFeil(null);
    try {
      await unloc.tilbakekall(orgId, vendorId, n.id);
      await last();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke kalle tilbake nøkkelen");
    } finally {
      setKaller(null);
    }
  }

  return (
    <>
      <Feil melding={feil} />
      {data === null ? (
        !feil && <Tom tekst="Henter …" />
      ) : !data.koblet ? (
        <Tom tekst="Digitale nøkler krever at laget er koblet til Unloc. Kontoadmin setter det opp under Innstillinger → Integrasjoner." />
      ) : (
        <>
          {data.feil && (
            <div className="field-note" style={{ marginBottom: "10px", color: "var(--warn)" }}>
              Fikk ikke frisket opp tilstanden fra Unloc ({data.feil}). Lista viser sist kjente tilstand.
            </div>
          )}
          {kanRedigere && (
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "4px" }}>
              <button className="btn btn-ghost" onClick={() => apneSkjema(true)}>
                <Smartphone size={14} strokeWidth={2} aria-hidden />
                Del ut nøkkel
              </button>
            </div>
          )}
          {data.nokler.length === 0 ? (
            <Tom tekst="Ingen digitale nøkler delt ut til denne leverandøren." />
          ) : (
            data.nokler.map((n) => {
              const t = NOKKEL_TILSTAND[n.state] ?? { etikett: n.state, merke: "muted" };
              return (
                <Rad
                  key={n.id}
                  tittel={
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                      <Smartphone size={14} strokeWidth={2} aria-hidden />
                      {n.lockName} · {n.holderName}
                    </span>
                  }
                  meta={
                    <>
                      {visTelefon(n.phone)} · {n.endAt ? `${datoTid(n.startAt)} → ${datoTid(n.endAt)}` : `fra ${datoTid(n.startAt)}, uten utløp`}
                      <br />
                      Delt ut av {n.issuedBy} {dato(n.createdAt)}
                      {n.revokedAt && ` · kalt tilbake av ${n.revokedBy ?? "ukjent"} ${dato(n.revokedAt)}`}
                      {n.note && ` · ${n.note}`}
                    </>
                  }
                  hoyre={
                    <>
                      <span className={`badge ${t.merke}`}>{t.etikett}</span>
                      {kanRedigere && LEVENDE.has(n.state) && !n.revokedAt && (
                        <button
                          className="btn btn-ghost"
                          style={{ color: "var(--muted)" }}
                          disabled={kaller === n.id}
                          onClick={() => void kallTilbake(n)}
                        >
                          {kaller === n.id ? "Kaller tilbake …" : "Kall tilbake"}
                        </button>
                      )}
                    </>
                  }
                />
              );
            })
          )}
          <div className="field-note" style={{ marginTop: "12px" }}>
            Mottakeren får nøkkelen i Unloc-appen på mobilnummeret. Utdeling og tilbakekalling føres i
            hendelsesloggen med navnet på den i styret som gjorde det.
          </div>
        </>
      )}

      {skjema && (
        <DelUtSkjema
          orgId={orgId}
          vendorId={vendorId}
          kontakter={kontakter}
          onLukk={() => apneSkjema(false)}
          onLagret={last}
        />
      )}
    </>
  );
}

/**
 * Gyldighet uten `datetime-local`: start er «nå» eller en dato + et klokkeslett, og slutten
 * er én av fire faste VARIGHETER — det er slik styret tenker («Ola skal ha nøkkel ut
 * dagen»), ikke som to tidspunkter man må stave ut hver for seg. Fire valg, ingen egen
 * sluttdato, med vilje: en nøkkel som trengs lenger enn 30 dager er en fast nøkkel.
 */
const VARIGHETER: ReadonlyArray<{ nokkel: string; etikett: string; slutt: (start: Date) => Date | null }> = [
  { nokkel: "dag", etikett: "I dag (ut dagen)", slutt: (s) => { const d = new Date(s); d.setHours(23, 59, 0, 0); return d; } },
  { nokkel: "7d", etikett: "7 dager", slutt: (s) => new Date(s.getTime() + 7 * 24 * 3600_000) },
  { nokkel: "30d", etikett: "30 dager", slutt: (s) => new Date(s.getTime() + 30 * 24 * 3600_000) },
  { nokkel: "fast", etikett: "Fast (til den trekkes tilbake)", slutt: () => null },
];

/** Dato («2026-09-12») + klokkeslett («08:00», tom = 00:00) i lokal tid → Date, eller null. */
function lokalTid(dato: string, tid: string): Date | null {
  if (!dato) return null;
  const d = new Date(`${dato}T${tid || "00:00"}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const iDag = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function DelUtSkjema({
  orgId,
  vendorId,
  kontakter,
  onLukk,
  onLagret,
}: {
  orgId: string;
  vendorId: string;
  kontakter: ReadonlyArray<{ id: string; name: string; phone: string | null }>;
  onLukk: () => void;
  onLagret: () => Promise<void>;
}) {
  const [laaser, setLaaser] = useState<UnlocLaas[] | null>(null);
  const [laasFeil, setLaasFeil] = useState<string | null>(null);
  const [lockId, setLockId] = useState("");
  // Første kontakt med nummer (primærkontakten kommer først fra API-et) er forhåndsvalgt —
  // det vanlige tilfellet er «send til vaktmesteren», ikke å skrive inn et nytt nummer.
  const forste = kontakter.find((k) => k.phone) ?? null;
  const [kontaktId, setKontaktId] = useState(forste?.id ?? "");
  const [navn, setNavn] = useState(forste?.name ?? "");
  const [telefon, setTelefon] = useState(forste?.phone ?? "");
  const [startValg, setStartValg] = useState<"naa" | "egen">("naa");
  const [startDato, setStartDato] = useState(iDag);
  const [startTid, setStartTid] = useState("08:00");
  const [varighet, setVarighet] = useState("dag");
  const [notat, setNotat] = useState("");

  // Utregnet gyldighet — vises under feltene så man ser hva som faktisk sendes.
  const start = startValg === "egen" ? lokalTid(startDato, startTid) : null;
  const slutt = VARIGHETER.find((v) => v.nokkel === varighet)?.slutt(start ?? new Date()) ?? null;
  const gyldighetFeil =
    startValg === "egen" && !start ? "Velg en startdato." :
    start && start.getTime() < Date.now() - 3600_000 ? "Starten kan ikke ligge i fortid." :
    slutt && slutt.getTime() <= (start ?? new Date()).getTime() ? "Slutten må være etter starten — velg en lengre varighet." : null;
  const { sender, feil, send } = useSending(async () => {
    await onLagret();
    onLukk();
  });

  useEffect(() => {
    let aktiv = true;
    unloc
      .laaser(orgId)
      .then((l) => {
        if (!aktiv) return;
        setLaaser(l);
        if (l[0] && !lockId) setLockId(l[0].id);
      })
      .catch((e) => aktiv && setLaasFeil(e instanceof Error ? e.message : "Kunne ikke hente låsene"));
    return () => {
      aktiv = false;
    };
    // Kun ved åpning — låsene hentes én gang per skjema.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  /** Kontaktperson valgt → navn og nummer fylles ut, men kan overstyres i feltene under. */
  function velgKontakt(id: string) {
    setKontaktId(id);
    const k = kontakter.find((x) => x.id === id);
    if (k) {
      setNavn(k.name);
      setTelefon(k.phone ?? "");
    }
  }

  return (
    <Modal tittel="Del ut digital nøkkel" onLukk={onLukk} bredde={560}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(() =>
            unloc.delUt(orgId, vendorId, {
              lockId,
              phone: telefon.trim(),
              holderName: navn.trim(),
              startAt: start ? start.toISOString() : null,
              endAt: slutt ? slutt.toISOString() : null,
              note: notat.trim() || null,
            }),
          );
        }}
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
      >
        <Feil melding={feil ?? laasFeil} />
        {laaser === null && !laasFeil ? (
          <Tom tekst="Henter låsene fra Unloc …" />
        ) : laaser && laaser.length === 0 ? (
          <Tom tekst="Unloc-prosjektet har ingen låser ennå." />
        ) : laaser ? (
          <Nedtrekk
            etikett="Lås *"
            verdi={lockId}
            onEndre={setLockId}
            valg={laaser.map((l) => ({ verdi: l.id, etikett: `${l.name}${l.floor ? ` (${l.floor})` : ""}${l.battery === "Low" ? " — lavt batteri" : ""}` }))}
          />
        ) : null}
        <Nedtrekk
          etikett="Mottaker"
          verdi={kontaktId}
          onEndre={velgKontakt}
          valg={[
            ...kontakter.map((k) => ({ verdi: k.id, etikett: k.phone ? `${k.name} (${k.phone})` : `${k.name} — mangler mobilnummer` })),
            { verdi: "", etikett: kontakter.length ? "Noen andre — skriv inn under" : "Ingen kontaktpersoner registrert — skriv inn under" },
          ]}
          notat={kontakter.length ? "Leverandørens kontaktpersoner. Navn og nummer kan justeres under." : "Legg inn kontaktpersoner under fanen «Kontaktpersoner», så velges de herfra neste gang."}
        />
        <div className="field-row">
          <Tekstfelt etikett="Navn på mottaker *" verdi={navn} onEndre={setNavn} plassholder="Ola Rørlegger" />
          <Tekstfelt etikett="Mobilnummer *" verdi={telefon} onEndre={setTelefon} plassholder="912 34 567" notat="Nøkkelen sendes til Unloc-appen på dette nummeret." />
        </div>
        <div className="field-row">
          <Nedtrekk
            etikett="Gyldig fra"
            verdi={startValg}
            onEndre={(v) => setStartValg(v as "naa" | "egen")}
            valg={[{ verdi: "naa", etikett: "Nå" }, { verdi: "egen", etikett: "Velg tidspunkt …" }]}
          />
          <Nedtrekk etikett="Varighet" verdi={varighet} onEndre={setVarighet} valg={VARIGHETER.map((v) => ({ verdi: v.nokkel, etikett: v.etikett }))} />
        </div>
        {startValg === "egen" && (
          <div className="field-row">
            <Tekstfelt etikett="Startdato" type="date" verdi={startDato} onEndre={setStartDato} />
            <Tekstfelt etikett="Klokkeslett" type="time" verdi={startTid} onEndre={setStartTid} />
          </div>
        )}
        <div className={gyldighetFeil ? "feilmelding" : "field-note"}>
          {gyldighetFeil ??
            `Nøkkelen virker fra ${start ? datoTid(start.toISOString()) : "nå"} ${slutt ? `til ${datoTid(slutt.toISOString())}` : "til den kalles tilbake"}.`}
        </div>
        <Tekstomrade etikett="Notat" verdi={notat} onEndre={setNotat} notat="Hvorfor — «service på heis uke 38». Vises i lista og i hendelsesloggen." />
        <Knapperad
          onAvbryt={onLukk}
          sendEtikett="Del ut nøkkel"
          sender={sender}
          deaktivert={!lockId || !navn.trim() || !telefon.trim() || !laaser?.length || gyldighetFeil !== null}
        />
      </form>
    </Modal>
  );
}
