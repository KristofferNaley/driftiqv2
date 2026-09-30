"use client";

import { useState } from "react";
import { Search, X } from "lucide-react";
import { Feil, Kort, Rad, Tom } from "@/components/felles";
import { Felt as Skjemafelt, Knapperad, Nedtrekk, Tekstfelt, useSending } from "@/components/skjema";
import { Bekreft } from "./felles";
import {
  tavleblokker,
  type AvgangerKonfig,
  type BlokkInn,
  type Holdeplasstreff,
  type Stedstreff,
  type Tavleblokk,
  type VaerKonfig,
} from "@/lib/klient";
import { MAKS_HOLDEPLASSER, VAERVISNING_ETIKETT, VAERVISNINGER, type Vaervisning } from "@/lib/vaerregler";

/**
 * Innholdsblokker med egne innstillinger: vær (MET/yr) og avganger (Entur). Lages og endres
 * i skjermoppsettet, og velges inn i et felt per skjerm (Feltkart.tsx). Innstillingene
 * gjelder hele borettslaget.
 * Designnotatet er `docs/entur-yr.md`.
 */
export const BLOKKTYPE_NAVN = { vaer: "Vær", avganger: "Avganger" } as const;

export function blokkBeskrivelse(b: Tavleblokk): string {
  if (!b.konfig) return "Ugyldige innstillinger. Åpne og lagre på nytt.";
  if (b.type === "vaer") return `${b.konfig.sted} · ${VAERVISNING_ETIKETT[b.konfig.visning]}`;
  return b.konfig.holdeplasser.map((h) => h.navn).join(" og ");
}

export function BlokkListe({
  blokker,
  kanRedigere,
  onRediger,
}: {
  blokker: Tavleblokk[];
  kanRedigere: boolean;
  onRediger: (b: Tavleblokk) => void;
}) {
  return (
    <Kort tittel="Vær og avganger">
      <div className="ot-felles">Gjelder hele borettslaget, ikke bare denne skjermen.</div>
      {blokker.length === 0 && <Tom tekst="Ingenting satt opp ennå." />}
      {blokker.map((b) => (
        <Rad
          key={b.id}
          tittel={b.navn}
          meta={`${BLOKKTYPE_NAVN[b.type]} · ${blokkBeskrivelse(b)}`}
          onClick={kanRedigere ? () => onRediger(b) : undefined}
        />
      ))}
    </Kort>
  );
}

/** Skjemaet for en vær- eller avgangsblokk. Sletting ligger her, ikke i lista. */
export function BlokkSkjema({
  orgId,
  type,
  eksisterende,
  onAvbryt,
  onLagret,
  onSlettet,
}: {
  orgId: string;
  type: "vaer" | "avganger";
  eksisterende: Tavleblokk | null;
  onAvbryt: () => void;
  /** Får blokken som ble lagret, så en ny kan legges rett inn i feltet den ble laget fra. */
  onLagret: (b: Tavleblokk) => void;
  onSlettet: () => void;
}) {
  const e = eksisterende;
  const [navn, setNavn] = useState(e?.navn ?? (type === "vaer" ? "Været" : "Neste avganger"));
  const vaerStart = e?.type === "vaer" ? e.konfig : null;
  const avgStart = e?.type === "avganger" ? e.konfig : null;
  const [sted, setSted] = useState<Stedstreff | null>(
    vaerStart ? { tekst: vaerStart.sted, lat: vaerStart.lat, lon: vaerStart.lon } : null,
  );
  const [visning, setVisning] = useState<Vaervisning>(vaerStart?.visning ?? "timer");
  const [holdeplasser, setHoldeplasser] = useState<AvgangerKonfig["holdeplasser"]>(avgStart?.holdeplasser ?? []);
  const [sletter, setSletter] = useState(false);
  // Tom `onFerdig`: `onLagret` trenger blokken svaret ga.
  const { sender, feil, send } = useSending(() => {});

  function lagre(ev: React.FormEvent) {
    ev.preventDefault();
    void send(async () => {
      let d: BlokkInn;
      if (type === "vaer") {
        if (!sted) throw new Error("Velg et sted");
        const konfig: VaerKonfig = { sted: sted.tekst, lat: sted.lat, lon: sted.lon, visning };
        d = { type: "vaer", navn, konfig };
      } else {
        if (holdeplasser.length === 0) throw new Error("Velg minst én holdeplass");
        d = { type: "avganger", navn, konfig: { holdeplasser } };
      }
      onLagret(e ? await tavleblokker.endre(orgId, e.id, d) : await tavleblokker.ny(orgId, d));
    });
  }

  return (
    <form onSubmit={lagre} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <Tekstfelt
        etikett="Navn i oversikten"
        verdi={navn}
        onEndre={setNavn}
        notat="Vises bare i appen, når du velger innhold til feltene."
      />
      {type === "vaer" ? (
        <>
          <Skjemafelt etikett="Sted" notat="Søk på adressen til bygget. Varselet er fra MET Norway (samme som yr.no).">
            {sted ? (
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <span className="list-tittel">{sted.tekst}</span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSted(null)}>
                  Bytt
                </button>
              </div>
            ) : (
              <Oppslagsfelt<Stedstreff>
                plassholder="Håsteins gate 9 Bergen"
                sok={(q) => tavleblokker.sokSted(orgId, q)}
                tekst={(t) => t.tekst}
                onVelg={setSted}
              />
            )}
          </Skjemafelt>
          <Nedtrekk
            etikett="Vis"
            verdi={visning}
            onEndre={(v) => setVisning(v as Vaervisning)}
            valg={VAERVISNINGER.map((v) => ({ verdi: v, etikett: VAERVISNING_ETIKETT[v] }))}
          />
        </>
      ) : (
        <Skjemafelt etikett="Holdeplasser" notat={`Maks ${MAKS_HOLDEPLASSER}. Sanntid fra Entur, oppdateres hvert minutt.`}>
          {holdeplasser.map((h) => (
            <div key={h.id} style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "6px" }}>
              <span className="list-tittel">{h.navn}</span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                aria-label={`Fjern ${h.navn}`}
                onClick={() => setHoldeplasser((l) => l.filter((x) => x.id !== h.id))}
              >
                <X size={14} aria-hidden />
              </button>
            </div>
          ))}
          {holdeplasser.length < MAKS_HOLDEPLASSER && (
            <Oppslagsfelt<Holdeplasstreff>
              plassholder="Danmarks plass"
              sok={(q) => tavleblokker.sokHoldeplass(orgId, q)}
              tekst={(t) => [t.navn, t.sted].filter(Boolean).join(", ")}
              onVelg={(t) =>
                setHoldeplasser((l) => (l.some((x) => x.id === t.id) ? l : [...l, { id: t.id, navn: t.navn }]))
              }
            />
          )}
        </Skjemafelt>
      )}
      <div className="field-note">Innstillingene gjelder hele borettslaget. Hvor det vises, velger du i kartet for hver skjerm.</div>
      <Feil melding={feil} />
      <div className="ot-skjemafot">
        {e ? (
          <button type="button" className="btn btn-ghost" onClick={() => setSletter(true)}>
            Slett
          </button>
        ) : (
          <span />
        )}
        <Knapperad onAvbryt={onAvbryt} sender={sender} sendEtikett={e ? "Lagre" : "Legg til"} />
      </div>
      {sletter && e && (
        <Bekreft
          tittel={`Slette «${e.navn}»?`}
          etikett="Slett"
          sender={sender}
          onAvbryt={() => setSletter(false)}
          onBekreft={() => void send(async () => (await tavleblokker.slett(orgId, e.id), onSlettet()))}
        >
          Den fjernes fra alle skjermer med en gang.
        </Bekreft>
      )}
    </form>
  );
}

/** Søkefelt med treffliste — søket går gjennom vårt API (proxy), aldri direkte fra nettleseren. */
function Oppslagsfelt<T>({
  plassholder,
  sok,
  tekst,
  onVelg,
}: {
  plassholder: string;
  sok: (q: string) => Promise<T[]>;
  tekst: (t: T) => string;
  onVelg: (t: T) => void;
}) {
  const [q, setQ] = useState("");
  const [treff, setTreff] = useState<T[] | null>(null);
  const [feil, setFeil] = useState<string | null>(null);
  const [soker, setSoker] = useState(false);

  async function kjor() {
    setSoker(true);
    setFeil(null);
    try {
      setTreff(await sok(q));
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Søket feilet");
    } finally {
      setSoker(false);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", gap: "8px" }}>
        <input
          className="input"
          value={q}
          placeholder={plassholder}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            // Enter i søkefeltet skal søke, ikke sende inn hele skjemaet.
            if (e.key === "Enter") {
              e.preventDefault();
              void kjor();
            }
          }}
        />
        <button type="button" className="btn btn-ghost" disabled={soker || q.trim().length < 2} onClick={() => void kjor()}>
          <Search size={14} aria-hidden /> Søk
        </button>
      </div>
      <Feil melding={feil} />
      {treff && treff.length === 0 && <div className="field-note">Ingen treff.</div>}
      {treff && treff.length > 0 && (
        <div className="ot-treff">
          {treff.map((t, i) => (
            <button
              type="button"
              key={i}
              className="ot-treff-rad"
              onClick={() => {
                onVelg(t);
                setTreff(null);
                setQ("");
              }}
            >
              {tekst(t)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
