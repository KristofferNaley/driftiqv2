"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Feil, Kort } from "@/components/felles";
import { Felt as Skjemafelt, Modal, Nedtrekk, Tekstfelt, useSending } from "@/components/skjema";
import {
  oppslagstavle,
  type BirStatus,
  type Skjerm,
  type SkjermEndring,
  type Tavleblokk,
  type Tavlekontakt,
  type Tavleutseende,
} from "@/lib/klient";
import {
  FORVALG,
  RETNING_ETIKETT,
  RETNINGER,
  SKALERINGER,
  STANDARD_SKALERING,
  type Retning,
} from "@/lib/oppslagstavleregler";
import { finnMal, ryddFelt, type Felt, type Mal } from "@/lib/tavlemaler";
import { BirKort } from "./BirKort";
import { BLOKKTYPE_NAVN, BlokkListe, BlokkSkjema } from "./Blokker";
import { Feltkart, Feltvelger, MalVelger } from "./Feltkart";
import { Kontaktpersoner } from "./Kontaktpersoner";
import { Bekreft, manglerOppsett, sistSett } from "./felles";

/**
 * «Skjermer og oppsett»: mal og felt per skjerm, innstillingene for det som står i feltene
 * (vær, avganger, tømmedager, kontaktpersoner), utseende og drift.
 *
 * Skjerminnstillinger, farger og nettbrudd-valget lagres IKKE her: de er et utkast som eies
 * av siden (`page.tsx`) og lagres med den faste linja nederst. Det som er filopplasting eller
 * kall til en tredjepart (logo, BIR, kontaktpersoner, vær og avganger) lagres straks i sitt
 * eget vindu.
 */

export type Utseendeverdi = Omit<Tavleutseende, "harLogo">;

/** Feltene (uten stripen) som ikke viser noe: tomme, eller bare innhold som mangler oppsett. */
export function feltUtenInnhold(mal: Mal, felt: Felt, blokker: Tavleblokk[], bir: BirStatus): string[] {
  return mal.soner.filter((f) => (felt[f] ?? []).every((n) => manglerOppsett(n, blokker, bir)));
}

export function Skjermliste({
  skjermer,
  valgt,
  valgtFelt,
  onVelg,
  blokker,
  bir,
}: {
  skjermer: Skjerm[];
  valgt: Skjerm | null;
  /** Feltene slik de står i utkastet for den valgte skjermen. */
  valgtFelt: { mal: Mal; felt: Felt } | null;
  onVelg: (id: string) => void;
  blokker: Tavleblokk[];
  bir: BirStatus;
}) {
  return (
    <Kort tittel={`Skjermer (${skjermer.length})`}>
      <div className="card-body">
        <div className="auto-grid">
          {skjermer.map((s) => {
            const erValgt = valgt?.id === s.id;
            const tomme =
              erValgt && valgtFelt
                ? feltUtenInnhold(valgtFelt.mal, valgtFelt.felt, blokker, bir)
                : feltUtenInnhold(finnMal(s.mal, s.retning), s.soner, blokker, bir);
            return (
              <button key={s.id} className={`ot-skjermkort${erValgt ? " valgt" : ""}`} onClick={() => onVelg(s.id)}>
                <b>{s.navn}</b>
                <span>
                  <i className={`ot-prikk ${s.paaNett ? "ok" : "nede"}`} />
                  {s.paaNett ? "På nett" : sistSett(s.sistSett)}
                </span>
                <span>
                  {RETNING_ETIKETT[s.retning]}
                  {s.adresse ? ` · ${s.adresse}` : ""}
                </span>
                {tomme.length > 0 && (
                  <span className="ot-skjermkort-varsel">
                    <AlertTriangle size={12} aria-hidden /> {tomme.length} felt uten innhold
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </Kort>
  );
}

/** Mal, felt og innstillinger for én skjerm, og oppsettet for det som står i det valgte feltet. */
export function Skjermoppsett({
  orgId,
  skjerm,
  verdi,
  onEndre,
  valgtFelt,
  onVelgFelt,
  blokker,
  bir,
  kontakter,
  erAdmin,
  kanRedigere,
  onEndret,
  onFjernet,
  utenFjern,
}: {
  orgId: string;
  skjerm: Skjerm;
  /** Skjermen slik den står i utkastet. */
  verdi: SkjermEndring;
  onEndre: (e: Partial<SkjermEndring>) => void;
  valgtFelt: string | null;
  onVelgFelt: (felt: string | null) => void;
  blokker: Tavleblokk[];
  bir: BirStatus;
  kontakter: Tavlekontakt[];
  erAdmin: boolean;
  kanRedigere: boolean;
  onEndret: () => void;
  onFjernet: () => void;
  /** Første gangs oppsett: ingen grunn til å tilby å fjerne skjermen som nettopp ble koblet. */
  utenFjern?: boolean;
}) {
  const mal = finnMal(verdi.mal, verdi.retning);
  const [blokkSkjema, setBlokkSkjema] = useState<{ type: "vaer" | "avganger"; eksisterende: Tavleblokk | null } | null>(null);
  const [fjerner, setFjerner] = useState(false);
  const { sender, feil, send } = useSending(onFjernet);
  const felt = valgtFelt && valgtFelt in verdi.felt ? valgtFelt : null;
  const iFeltet = felt ? (verdi.felt[felt] ?? []) : [];

  function byttRetning(retning: Retning) {
    const ny = finnMal(null, retning);
    onEndre({ retning, mal: ny.id, felt: ryddFelt(ny, verdi.felt) });
  }

  return (
    <>
      <Kort tittel={`Oppsett for ${skjerm.navn}`}>
        <div className="card-body ot-skjermoppsett">
          {!erAdmin && <div className="field-note">Bare orgadmin kan endre mal, felt og innstillinger for skjermen.</div>}
          <MalVelger
            retning={verdi.retning}
            malId={mal.id}
            laast={!erAdmin}
            onEndre={(id) => onEndre({ mal: id, felt: ryddFelt(finnMal(id, verdi.retning), verdi.felt) })}
          />
          <Skjemafelt
            etikett="Felt på skjermen"
            notat="Klikk på et felt for å velge hva som vises der. Forhåndsvisningen markerer feltet du har valgt."
          >
            <Feltkart mal={mal} felt={verdi.felt} valgt={felt} onVelg={(f) => onVelgFelt(f === felt ? null : f)} blokker={blokker} bir={bir} />
          </Skjemafelt>
          {felt && (
            <Feltvelger
              mal={mal}
              felt={verdi.felt}
              valgt={felt}
              onEndre={(nokler) => onEndre({ felt: { ...verdi.felt, [felt]: nokler } })}
              blokker={blokker}
              bir={bir}
              laast={!erAdmin}
              kanLageBlokk={kanRedigere}
              onNyBlokk={(type) => setBlokkSkjema({ type, eksisterende: null })}
            />
          )}
          {erAdmin && (
            <>
              <div className="ot-to">
                <Tekstfelt etikett="Navn" verdi={verdi.navn} onEndre={(navn) => onEndre({ navn })} />
                <Tekstfelt
                  etikett="Adresse på skjermen"
                  verdi={verdi.adresse ?? ""}
                  onEndre={(adresse) => onEndre({ adresse: adresse || null })}
                />
              </div>
              <div className="ot-to">
                <Nedtrekk
                  etikett="Retning"
                  verdi={verdi.retning}
                  onEndre={(v) => byttRetning(v as Retning)}
                  valg={RETNINGER.map((r) => ({ verdi: r, etikett: RETNING_ETIKETT[r] }))}
                  notat="Følger hvordan skjermen er montert."
                />
                <Nedtrekk
                  etikett="Skalering"
                  verdi={String(verdi.skala)}
                  onEndre={(v) => onEndre({ skala: Number(v) })}
                  valg={SKALERINGER.map((n) => ({
                    verdi: String(n),
                    etikett: `${n} %${n === STANDARD_SKALERING ? " (standard)" : ""}`,
                  }))}
                  notat="Mindre gir plass til mer innhold, større leses på lengre avstand. Oppløsningen spiller ingen rolle: 4K og Full HD ser like ut."
                />
              </div>
              {!utenFjern && (
                <div>
                  <button type="button" className="btn btn-ghost" onClick={() => setFjerner(true)}>
                    Fjern skjerm
                  </button>
                </div>
              )}
            </>
          )}
          <Feil melding={feil} />
        </div>
      </Kort>

      {/* Oppsettet for det som står i det valgte feltet. Gjelder hele borettslaget. */}
      {iFeltet.some((n) => n.startsWith("blokk:")) && (
        <BlokkListe
          blokker={blokker}
          kanRedigere={kanRedigere}
          onRediger={(b) => setBlokkSkjema({ type: b.type, eksisterende: b })}
        />
      )}
      {iFeltet.includes("tommedager") && <BirKort erAdmin={kanRedigere} onEndret={onEndret} />}
      {iFeltet.includes("kontakt") && (
        <Kontaktpersoner orgId={orgId} kontakter={kontakter} erAdmin={erAdmin} onEndret={onEndret} />
      )}

      {blokkSkjema && (
        <Modal
          tittel={`${blokkSkjema.eksisterende ? "Endre" : "Legg til"} ${BLOKKTYPE_NAVN[blokkSkjema.type].toLowerCase()}`}
          onLukk={() => setBlokkSkjema(null)}
          bredde={720}
        >
          <BlokkSkjema
            orgId={orgId}
            type={blokkSkjema.type}
            eksisterende={blokkSkjema.eksisterende}
            onAvbryt={() => setBlokkSkjema(null)}
            onLagret={(b) => {
              // En ny blokk legges rett i feltet den ble laget fra, som en ulagret endring.
              if (!blokkSkjema.eksisterende && felt && erAdmin && !iFeltet.includes(b.nokkel)) {
                onEndre({ felt: { ...verdi.felt, [felt]: [...iFeltet, b.nokkel] } });
              }
              setBlokkSkjema(null);
              onEndret();
            }}
            onSlettet={() => {
              setBlokkSkjema(null);
              onEndret();
            }}
          />
        </Modal>
      )}
      {fjerner && (
        <Bekreft
          tittel={`Fjerne «${skjerm.navn}»?`}
          etikett="Fjern skjerm"
          sender={sender}
          onAvbryt={() => setFjerner(false)}
          onBekreft={() => void send(() => oppslagstavle.slettSkjerm(orgId, skjerm.id))}
        >
          Skjermen går tilbake til koblingskoden og må kobles til på nytt.
        </Bekreft>
      )}
    </>
  );
}

export function Utseende({
  orgId,
  harLogo,
  verdi,
  onEndre,
  onEndret,
}: {
  orgId: string;
  harLogo: boolean;
  verdi: Utseendeverdi;
  onEndre: (e: Partial<Utseendeverdi>) => void;
  onEndret: () => void;
}) {
  const { feil, send } = useSending(onEndret);
  // Ny logo ⇒ ny URL, ellers viser nettleseren den gamle fra hurtigbufferen.
  const [logoVersjon, setLogoVersjon] = useState(0);

  return (
    <Kort tittel="Utseende for hele borettslaget">
      <div className="card-body">
        <Skjemafelt etikett="Farger">
          <div className="ot-filter" style={{ marginBottom: "10px" }}>
            {FORVALG.map((f) => (
              <button
                type="button"
                key={f.id}
                className={`ot-chip${verdi.background === f.background && verdi.accent === f.accent ? " valgt" : ""}`}
                onClick={() => onEndre({ background: f.background, accent: f.accent })}
              >
                {f.navn}
              </button>
            ))}
          </div>
          <div className="ot-farger">
            <label>
              Bakgrunn
              <input type="color" value={verdi.background} onChange={(e) => onEndre({ background: e.target.value })} />
            </label>
            <label>
              Aksent
              <input type="color" value={verdi.accent} onChange={(e) => onEndre({ accent: e.target.value })} />
            </label>
          </div>
        </Skjemafelt>
        <Skjemafelt
          etikett="Logo"
          notat="PNG, JPG eller WebP, gjerne kvadratisk. Uten logo vises initialene. Logoen lagres med en gang du velger fil."
        >
          <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
            <div className="ot-logo-forh">
              {harLogo && <img src={`${oppslagstavle.logoSti(orgId)}?v=${logoVersjon}`} alt="Logo" />}
            </div>
            <input
              className="input"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              style={{ maxWidth: "260px" }}
              onChange={(e) => {
                const fil = e.target.files?.[0];
                if (fil) void send(() => oppslagstavle.lastOppLogo(orgId, fil).then(() => setLogoVersjon((v) => v + 1)));
              }}
            />
            {harLogo && (
              <button type="button" className="btn btn-ghost" onClick={() => void send(() => oppslagstavle.slettLogo(orgId))}>
                Bruk initialer
              </button>
            )}
          </div>
        </Skjemafelt>
        <Feil melding={feil} />
      </div>
    </Kort>
  );
}

export function Drift({ verdi, onEndre }: { verdi: Utseendeverdi; onEndre: (e: Partial<Utseendeverdi>) => void }) {
  return (
    <Kort tittel="Drift og varsling">
      <div className="card-body">
        <Nedtrekk
          etikett="Når skjermen mister nett"
          verdi={verdi.offlineMode}
          onEndre={(v) => onEndre({ offlineMode: v as Utseendeverdi["offlineMode"] })}
          valg={[
            { verdi: "siste", etikett: "Vis siste innhold, med en linje om at den er uten nett" },
            { verdi: "melding", etikett: "Vis en melding om at skjermen er uten nett" },
          ]}
          notat="Gjelder alle skjermene. Om en skjerm er på nett, ser du på skjermkortet øverst."
        />
      </div>
    </Kort>
  );
}
