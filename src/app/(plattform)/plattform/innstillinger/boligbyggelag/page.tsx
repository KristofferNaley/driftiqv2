"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/klient";
import { formatOrgNr } from "@/lib/orgnr";
import { FYLKER_ALFABETISK, fylkesliste } from "@/lib/fylker";
import { dato } from "@/components/felles";
import { Modal, Knapperad, Tekstfelt, Tekstomrade, useSending } from "@/components/skjema";
import { Underside } from "../underside";

/**
 * Registeret over boligbyggelag (BL-85).
 *
 * Globalt: lagene føres uavhengig av om noen kunde bruker dem, og flere kunder kan være
 * tilknyttet samme lag. Kundetallet teller både tilknytning og forretningsførsel.
 */

type Bbl = {
  id: string;
  name: string;
  orgNr: string | null;
  /** Fritekst fra før fylkeslista; satt bare når den ikke lot seg tolke. */
  region: string | null;
  countyCodes: string[] | null;
  website: string | null;
  notes: string | null;
  successorId: string | null;
  successorName: string | null;
  mergeDate: string | null;
  active: boolean;
  antallKunder: number;
};

export default function Boligbyggelag() {
  const [lag, setLag] = useState<Bbl[] | null>(null);
  const [feil, setFeil] = useState<string | null>(null);
  const [rediger, setRediger] = useState<Bbl | "ny" | null>(null);
  const [fusjon, setFusjon] = useState<Bbl | null>(null);
  /** Handlingen som venter på bekreftelse. `null` = ingen dialog oppe. */
  const [bekreft, setBekreft] = useState<
    { lag: Bbl; slag: "slett" | "gjennomfor" } | null
  >(null);

  async function last() {
    try {
      setLag(await api.hent<Bbl[]>("/plattform/bbl"));
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke hente registeret");
    }
  }

  useEffect(() => {
    void last();
  }, []);

  async function slett(b: Bbl) {
    setBekreft(null);
    setFeil(null);
    try {
      await api.slett(`/plattform/bbl/${b.id}`);
      await last();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke slette laget");
    }
  }

  async function gjennomfor(b: Bbl) {
    setBekreft(null);
    setFeil(null);
    try {
      await api.send(`/plattform/bbl/${b.id}/fusjon/gjennomfor`, {});
      await last();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke gjennomføre sammenslåingen");
    }
  }

  async function avlys(b: Bbl) {
    setFeil(null);
    try {
      await api.slett(`/plattform/bbl/${b.id}/fusjon`);
      await last();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke avlyse sammenslåingen");
    }
  }

  return (
    <Underside tittel="Boligbyggelag" ingress="Registeret kundene knyttes til.">
      {feil && <div className="feilmelding">{feil}</div>}

      <div className="pf-kort">
        <div className="pf-kort-hode">
          <span>Registeret</span>
          <button className="btn btn-primary" onClick={() => setRediger("ny")}>
            ＋ Nytt lag
          </button>
        </div>

        {!lag ? (
          <p className="pf-dempet" style={{ padding: "16px" }}>
            Henter …
          </p>
        ) : lag.length === 0 ? (
          <p className="pf-dempet" style={{ padding: "16px" }}>
            Ingen boligbyggelag registrert ennå.
          </p>
        ) : (
          <>
            <div className="pf-bbl-rad hode">
              <span>Navn</span>
              <span>Org.nr</span>
              <span>Fylke</span>
              <span>Kunder</span>
              <span>Status</span>
              <span />
            </div>
            {lag.map((b) => (
              <div key={b.id} className="pf-bbl-rad">
                <span>
                  <span className="pf-navn">{b.name}</span>
                  {b.successorId && (
                    <span className="pf-under">
                      Slås sammen med {b.successorName}
                      {b.mergeDate ? ` · ${dato(b.mergeDate)}` : ""}
                    </span>
                  )}
                </span>
                <span className="pf-dempet">{formatOrgNr(b.orgNr) ?? "Ikke satt"}</span>
                <span className="pf-dempet">
                  {b.countyCodes?.length
                    ? fylkesliste(b.countyCodes)
                    : b.region
                      ? `Ukjent («${b.region}»)`
                      : "Ikke satt"}
                </span>
                <span className="pf-tall">{b.antallKunder}</span>
                <span>
                  {!b.active ? (
                    <span className="pf-merkelapp utgatt">Utgått</span>
                  ) : b.successorId ? (
                    <span className="pf-merkelapp varsel">Sammenslåing varslet</span>
                  ) : (
                    <span className="pf-merkelapp aktiv">Aktiv</span>
                  )}
                </span>
                <Radmeny
                  etikett={`Valg for ${b.name}`}
                  valg={[
                    { etikett: "Rediger", onVelg: () => setRediger(b) },
                    ...(b.active && b.successorId
                      ? [
                          {
                            etikett: "Gjennomfør sammenslåing",
                            under: `Kundene flyttes til ${b.successorName}`,
                            onVelg: () => setBekreft({ lag: b, slag: "gjennomfor" as const }),
                          },
                          { etikett: "Avlys sammenslåing", onVelg: () => void avlys(b) },
                        ]
                      : b.active
                        ? [
                            {
                              etikett: "Slå sammen med …",
                              under: "Kundene flyttes, laget blir stående som utgått",
                              onVelg: () => setFusjon(b),
                            },
                          ]
                        : []),
                    {
                      etikett: "Slett",
                      farlig: true,
                      // Sletting er bare for feilregistreringer. API-et avviser et lag i bruk
                      // uansett; her sier menyen hvorfor i stedet for å skjule valget.
                      deaktivert:
                        b.antallKunder > 0
                          ? `Har ${b.antallKunder} ${b.antallKunder === 1 ? "kunde" : "kunder"}. Bruk sammenslåing.`
                          : undefined,
                      onVelg: () => setBekreft({ lag: b, slag: "slett" }),
                    },
                  ]}
                />
              </div>
            ))}
          </>
        )}
      </div>

      <p className="field-note">
        Et lag som er i bruk kan ikke slettes. Da mister kundene tilknytningen sin, og en
        årsberetning fra i fjor kan ikke lenger si hvilket lag de tilhørte. Slå det heller
        sammen med et annet lag: kundene flyttes over, og det gamle laget blir stående som
        utgått.
      </p>

      {rediger && (
        <RedigerModal
          lag={rediger === "ny" ? null : rediger}
          onLukk={() => setRediger(null)}
          onLagret={() => {
            setRediger(null);
            void last();
          }}
        />
      )}

      {bekreft && (
        <Modal
          tittel={bekreft.slag === "slett" ? "Slett boligbyggelag" : "Gjennomfør sammenslåing"}
          onLukk={() => setBekreft(null)}
          bredde={420}
        >
          {bekreft.slag === "slett" ? (
            <p style={{ fontSize: "var(--fs-sm)", lineHeight: 1.6 }}>
              Slette <strong>{bekreft.lag.name}</strong> fra registeret? Ingen kunder er koblet
              til laget, så ingen historikk går tapt.
            </p>
          ) : (
            <>
              <p style={{ fontSize: "var(--fs-sm)", lineHeight: 1.6 }}>
                Flytte {bekreft.lag.antallKunder} kunde
                {bekreft.lag.antallKunder === 1 ? "" : "r"} fra{" "}
                <strong>{bekreft.lag.name}</strong> til{" "}
                <strong>{bekreft.lag.successorName}</strong>?
              </p>
              <div className="tips-stripe" style={{ margin: "12px 0" }}>
                <span style={{ fontSize: "var(--fs-sm)", lineHeight: 1.6 }}>
                  🛡 Det gamle laget blir stående som utgått, ikke slettet. Uten det kan ikke en
                  årsberetning fra i fjor si hvilket lag kundene tilhørte den gang.
                </span>
              </div>
            </>
          )}
          <Knapperad
            onAvbryt={() => setBekreft(null)}
            sendEtikett={bekreft.slag === "slett" ? "Slett laget" : "Gjennomfør sammenslåingen"}
            farlig
            onSend={() =>
              void (bekreft.slag === "slett" ? slett(bekreft.lag) : gjennomfor(bekreft.lag))
            }
          />
        </Modal>
      )}

      {fusjon && (
        <FusjonModal
          lag={fusjon}
          alle={lag ?? []}
          onLukk={() => setFusjon(null)}
          onLagret={() => {
            setFusjon(null);
            void last();
          }}
        />
      )}
    </Underside>
  );
}

function RedigerModal({
  lag,
  onLukk,
  onLagret,
}: {
  lag: Bbl | null;
  onLukk: () => void;
  onLagret: () => void;
}) {
  const [navn, setNavn] = useState(lag?.name ?? "");
  const [orgNr, setOrgNr] = useState(lag?.orgNr ?? "");
  const [fylker, setFylker] = useState<string[]>(lag?.countyCodes ?? []);
  const [nettsted, setNettsted] = useState(lag?.website ?? "");
  const [notat, setNotat] = useState(lag?.notes ?? "");
  const { sender, feil, send } = useSending(onLagret);

  return (
    <Modal tittel={lag ? "Rediger boligbyggelag" : "Nytt boligbyggelag"} onLukk={onLukk}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(async () => {
            const kropp = {
              name: navn.trim(),
              orgNr: orgNr.trim() || null,
              countyCodes: fylker,
              website: nettsted.trim() || null,
              notes: notat.trim() || null,
            };
            if (lag) await api.endre(`/plattform/bbl/${lag.id}`, kropp);
            else await api.send("/plattform/bbl", kropp);
          });
        }}
      >
        {feil && <div className="feilmelding">{feil}</div>}
        <Tekstfelt etikett="Navn *" verdi={navn} onEndre={setNavn} />
        <Tekstfelt
          etikett="Organisasjonsnummer"
          verdi={orgNr}
          onEndre={setOrgNr}
          plassholder="938 765 432"
          notat="Lagres uten mellomrom, så samme lag ikke kan registreres to ganger."
        />
        <fieldset className="field pf-bbl-fylkevalg">
          <legend className="field-label">Fylker</legend>
          <div className="pf-bbl-fylker">
            {FYLKER_ALFABETISK.map((f) => (
              <label key={f.nr}>
                <input
                  type="checkbox"
                  checked={fylker.includes(f.nr)}
                  onChange={(e) =>
                    setFylker(e.target.checked ? [...fylker, f.nr] : fylker.filter((n) => n !== f.nr))
                  }
                />
                {f.navn}
              </label>
            ))}
          </div>
          <div className="field-note">
            {lag?.region && !lag.countyCodes?.length
              ? `Sto før som «${lag.region}», som ikke kunne tolkes som et fylke. `
              : ""}
            Velg alle fylkene laget har kunder i.
          </div>
        </fieldset>
        <Tekstfelt etikett="Nettsted" verdi={nettsted} onEndre={setNettsted} />
        <Tekstomrade etikett="Notat" verdi={notat} onEndre={setNotat} />
        <Knapperad onAvbryt={onLukk} sender={sender} deaktivert={!navn.trim()} />
      </form>
    </Modal>
  );
}

function FusjonModal({
  lag,
  alle,
  onLukk,
  onLagret,
}: {
  lag: Bbl;
  alle: Bbl[];
  onLukk: () => void;
  onLagret: () => void;
}) {
  const [etterfolger, setEtterfolger] = useState("");
  const [fusjonsdato, setFusjonsdato] = useState("");
  const { sender, feil, send } = useSending(onLagret);

  // Et lag kan ikke fusjoneres med seg selv, og et utgått lag er ikke et gyldig mål —
  // API-et avviser begge, men de skal heller ikke stå i lista.
  const valgbare = alle.filter((b) => b.id !== lag.id && b.active);

  return (
    <Modal tittel={`Slå sammen: ${lag.name}`} onLukk={onLukk}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(async () => {
            await api.send(`/plattform/bbl/${lag.id}/fusjon`, {
              successorId: etterfolger,
              mergeDate: fusjonsdato || null,
            });
          });
        }}
      >
        {feil && <div className="feilmelding">{feil}</div>}
        <div className="field">
          <label className="field-label" htmlFor="etterfolger">
            Slås sammen med *
          </label>
          <select
            id="etterfolger"
            className="input"
            value={etterfolger}
            onChange={(e) => setEtterfolger(e.target.value)}
          >
            <option value="">Velg boligbyggelag …</option>
            {valgbare.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <Tekstfelt etikett="Fusjonsdato" type="date" verdi={fusjonsdato} onEndre={setFusjonsdato} />
        <p className="field-note">
          Dette varsler bare. Kundene flyttes først når du velger «Gjennomfør sammenslåing» i
          ⋯-menyen. En sammenslåing er en hendelse noen følger opp, og styrene skal varsles av
          et menneske, ikke av en bakgrunnsjobb.
        </p>
        <Knapperad
          onAvbryt={onLukk}
          sendEtikett="Varsle sammenslåing"
          sender={sender}
          deaktivert={!etterfolger}
        />
      </form>
    </Modal>
  );
}

type Menyvalg = {
  etikett: string;
  /** Forklaring under etiketten. */
  under?: string;
  farlig?: boolean;
  /** Satt = valget er grått, og teksten sier hvorfor. */
  deaktivert?: string;
  onVelg: () => void;
};

/**
 * ⋯-menyen på en rad. Lukkes med Esc, klikk utenfor eller når et valg er tatt; fokus går
 * tilbake til knappen så tastaturbrukere ikke mister plassen sin.
 */
function Radmeny({ etikett, valg }: { etikett: string; valg: Menyvalg[] }) {
  const [apen, setApen] = useState(false);
  const rot = useRef<HTMLSpanElement>(null);
  const knapp = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!apen) return;
    const klikk = (e: MouseEvent) => {
      if (!rot.current?.contains(e.target as Node)) setApen(false);
    };
    const tast = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setApen(false);
        knapp.current?.focus();
      }
    };
    document.addEventListener("mousedown", klikk);
    document.addEventListener("keydown", tast);
    return () => {
      document.removeEventListener("mousedown", klikk);
      document.removeEventListener("keydown", tast);
    };
  }, [apen]);

  return (
    <span className="pf-bbl-meny" ref={rot}>
      <button
        ref={knapp}
        type="button"
        className="btn btn-ghost"
        aria-label={etikett}
        aria-haspopup="menu"
        aria-expanded={apen}
        onClick={() => setApen(!apen)}
      >
        ⋯
      </button>
      {apen && (
        <div className="pf-bbl-pop" role="menu">
          {valg.map((v) => (
            <button
              key={v.etikett}
              type="button"
              role="menuitem"
              className={v.farlig ? "farlig" : undefined}
              disabled={!!v.deaktivert}
              onClick={() => {
                setApen(false);
                v.onVelg();
              }}
            >
              {v.etikett}
              {(v.deaktivert ?? v.under) && <small>{v.deaktivert ?? v.under}</small>}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
