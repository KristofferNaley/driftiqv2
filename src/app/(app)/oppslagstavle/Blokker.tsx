"use client";

import { useState } from "react";
import { Pencil, Search, Trash2, X } from "lucide-react";
import { Feil, Kort, Rad, Tom } from "@/components/felles";
import { Felt as Skjemafelt, Knapperad, Nedtrekk, Tekstfelt, useSending } from "@/components/skjema";
import {
  tavleblokker,
  type AvgangerKonfig,
  type Holdeplasstreff,
  type Stedstreff,
  type Tavleblokk,
  type VaerKonfig,
} from "@/lib/klient";
import { MAKS_HOLDEPLASSER, VAERVISNING_ETIKETT, VAERVISNINGER, type Vaervisning } from "@/lib/vaerregler";

/**
 * Innholdsblokker med egne innstillinger: vær (MET/yr) og avganger (Entur). Lages under
 * «Nytt innhold», listes her, og plasseres i sonene per skjerm (SoneOppsett.tsx).
 * Designnotatet er `docs/entur-yr.md`.
 */
export const BLOKKTYPE_NAVN = { vaer: "Vær", avganger: "Avganger" } as const;

export function blokkBeskrivelse(b: Tavleblokk): string {
  if (!b.konfig) return "Ugyldige innstillinger — endre blokken";
  if (b.type === "vaer") return `${b.konfig.sted} · ${VAERVISNING_ETIKETT[b.konfig.visning]}`;
  return b.konfig.holdeplasser.map((h) => h.navn).join(" og ");
}

export function BlokkListe({
  orgId,
  blokker,
  kanRedigere,
  onRediger,
  onEndret,
}: {
  orgId: string;
  blokker: Tavleblokk[];
  kanRedigere: boolean;
  onRediger: (b: Tavleblokk) => void;
  onEndret: () => void;
}) {
  const [feil, setFeil] = useState<string | null>(null);
  return (
    <Kort tittel="Vær og avganger">
      <Feil melding={feil} />
      {blokker.length === 0 && (
        <Tom tekst="Ingen blokker ennå. Legg til vær eller avganger under «Nytt innhold», og plasser dem på skjermene." />
      )}
      {blokker.map((b) => (
        <Rad
          key={b.id}
          tittel={b.navn}
          meta={`${BLOKKTYPE_NAVN[b.type]} · ${blokkBeskrivelse(b)}`}
          onClick={kanRedigere ? () => onRediger(b) : undefined}
          hoyre={
            kanRedigere && (
              <>
                <button
                  className="btn btn-ghost btn-sm"
                  aria-label={`Endre ${b.navn}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRediger(b);
                  }}
                >
                  <Pencil size={14} aria-hidden />
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  aria-label={`Slett ${b.navn}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!window.confirm(`Slette «${b.navn}»? Den fjernes fra alle skjermer.`)) return;
                    setFeil(null);
                    tavleblokker
                      .slett(orgId, b.id)
                      .then(onEndret)
                      .catch((x: unknown) => setFeil(x instanceof Error ? x.message : "Kunne ikke slette"));
                  }}
                >
                  <Trash2 size={14} aria-hidden />
                </button>
              </>
            )
          }
        />
      ))}
    </Kort>
  );
}

/** Skjemaet for en vær- eller avgangsblokk. Brukes inne i «Nytt innhold»-modalen. */
export function BlokkSkjema({
  orgId,
  type,
  eksisterende,
  onAvbryt,
  onLagret,
}: {
  orgId: string;
  type: "vaer" | "avganger";
  eksisterende: Tavleblokk | null;
  onAvbryt: () => void;
  onLagret: () => void;
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
  const { sender, feil, send } = useSending(onLagret);

  function lagre(ev: React.FormEvent) {
    ev.preventDefault();
    void send(async () => {
      if (type === "vaer") {
        if (!sted) throw new Error("Velg et sted");
        const konfig: VaerKonfig = { sted: sted.tekst, lat: sted.lat, lon: sted.lon, visning };
        const d = { type: "vaer" as const, navn, konfig };
        return e ? tavleblokker.endre(orgId, e.id, d) : tavleblokker.ny(orgId, d);
      }
      if (holdeplasser.length === 0) throw new Error("Velg minst én holdeplass");
      const d = { type: "avganger" as const, navn, konfig: { holdeplasser } };
      return e ? tavleblokker.endre(orgId, e.id, d) : tavleblokker.ny(orgId, d);
    });
  }

  return (
    <form onSubmit={lagre} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <Tekstfelt
        etikett="Navn i oversikten"
        verdi={navn}
        onEndre={setNavn}
        notat="Vises bare i appen, for å skille blokkene når du plasserer dem på skjermene."
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
      <Feil melding={feil} />
      <Knapperad onAvbryt={onAvbryt} sender={sender} sendEtikett={e ? "Lagre" : "Legg til"} />
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
