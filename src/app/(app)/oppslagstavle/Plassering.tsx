"use client";

import { useState, type CSSProperties } from "react";
import { MapPin } from "lucide-react";
import { Feil } from "@/components/felles";
import { Avkryssing, Felt as Skjemafelt, Knapperad, Modal, useSending } from "@/components/skjema";
import { oppslagstavle, type Plassering, type Skjerm } from "@/lib/klient";
import type { Retning } from "@/lib/oppslagstavleregler";
import { OMRADER, OMRADE_BESKRIVELSE, OMRADE_ETIKETT, STRIPE, malerFor, type Mal, type Omrade } from "@/lib/tavlemaler";

/**
 * HVOR innhold vises velges på innholdet: et område (hovedfelt, sidefelt, stripe) og hvilke
 * skjermer. Skjermen velger bare mal; `fordelSoner` regner ut resten. Se docs/oppslagstavle.md.
 */

export function plasseringTekst(p: Plassering | undefined, skjermer: Skjerm[]): string {
  if (!p) return "";
  if (p.omrade === "av") return OMRADE_ETIKETT.av;
  const hvor = p.alleSkjermer
    ? "alle skjermer"
    : p.skjermIder.map((id) => skjermer.find((s) => s.id === id)?.navn ?? "fjernet skjerm").join(", ");
  return `${OMRADE_ETIKETT[p.omrade]} · ${hvor}`;
}

/** Område- og skjermvalg. Kontrollert — brukes både alene (modal) og inne i blokkskjemaet. */
export function PlasseringFelter({
  verdi,
  skjermer,
  onEndre,
}: {
  verdi: Omit<Plassering, "nokkel">;
  skjermer: Skjerm[];
  onEndre: (v: Omit<Plassering, "nokkel">) => void;
}) {
  return (
    <>
      <Skjemafelt etikett="Hvor på skjermen" notat={OMRADE_BESKRIVELSE[verdi.omrade]}>
        <div className="ot-filter">
          {OMRADER.map((o: Omrade) => (
            <button
              type="button"
              key={o}
              className={`ot-chip${verdi.omrade === o ? " valgt" : ""}`}
              onClick={() => onEndre({ ...verdi, omrade: o })}
            >
              {OMRADE_ETIKETT[o]}
            </button>
          ))}
        </div>
      </Skjemafelt>
      {verdi.omrade !== "av" && (
        <>
          <Avkryssing
            etikett="Vis på alle skjermer"
            verdi={verdi.alleSkjermer}
            onEndre={(v) => onEndre({ ...verdi, alleSkjermer: v })}
            notat="Gjelder også skjermer som kobles til senere."
          />
          {!verdi.alleSkjermer && (
            <div className="ot-filter">
              {skjermer.map((s) => (
                <button
                  type="button"
                  key={s.id}
                  className={`ot-chip${verdi.skjermIder.includes(s.id) ? " valgt" : ""}`}
                  onClick={() =>
                    onEndre({
                      ...verdi,
                      skjermIder: verdi.skjermIder.includes(s.id)
                        ? verdi.skjermIder.filter((x) => x !== s.id)
                        : [...verdi.skjermIder, s.id],
                    })
                  }
                >
                  {s.navn}
                </button>
              ))}
              {skjermer.length === 0 && <span className="field-note">Ingen skjermer er koblet til ennå.</span>}
            </div>
          )}
        </>
      )}
    </>
  );
}

/** «Vises: Sidefelt · alle skjermer  [Endre]» — øverst i kortene i Innhold-fanen. */
export function Plasseringslinje({
  orgId,
  plassering,
  skjermer,
  kanRedigere,
  onEndret,
}: {
  orgId: string;
  plassering: Plassering | undefined;
  skjermer: Skjerm[];
  kanRedigere: boolean;
  onEndret: () => void;
}) {
  const [apen, setApen] = useState(false);
  if (!plassering) return null;
  return (
    <div className="ot-plassering">
      <MapPin size={13} aria-hidden />
      <span>Vises: {plasseringTekst(plassering, skjermer)}</span>
      {kanRedigere && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setApen(true)}>
          Endre
        </button>
      )}
      {apen && (
        <PlasseringModal
          orgId={orgId}
          plassering={plassering}
          skjermer={skjermer}
          onLukk={() => setApen(false)}
          onLagret={() => {
            setApen(false);
            onEndret();
          }}
        />
      )}
    </div>
  );
}

function PlasseringModal({
  orgId,
  plassering,
  skjermer,
  onLukk,
  onLagret,
}: {
  orgId: string;
  plassering: Plassering;
  skjermer: Skjerm[];
  onLukk: () => void;
  onLagret: () => void;
}) {
  const [verdi, setVerdi] = useState<Omit<Plassering, "nokkel">>(plassering);
  const { sender, feil, send } = useSending(onLagret);
  return (
    <Modal tittel="Hvor skal dette vises?" onLukk={onLukk}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(() => oppslagstavle.settPlassering(orgId, { nokkel: plassering.nokkel, ...verdi }));
        }}
        style={{ display: "flex", flexDirection: "column", gap: "14px" }}
      >
        <PlasseringFelter verdi={verdi} skjermer={skjermer} onEndre={setVerdi} />
        <Feil melding={feil} />
        <Knapperad onAvbryt={onLukk} sender={sender} />
      </form>
    </Modal>
  );
}

/** Malvalget per skjerm — miniatyrene viser inndelingen. Det eneste som styres per skjerm. */
export function MalVelger({
  retning,
  malId,
  onEndre,
}: {
  retning: Retning;
  malId: string;
  onEndre: (malId: string) => void;
}) {
  return (
    <Skjemafelt
      etikett="Mal"
      notat="Hvordan skjermen deles opp. Hva som havner hvor, velges på innholdet (Hovedfelt, Sidefelt, Stripe). Blir et felt stående tomt, velg en mal med færre felt."
    >
      <div className="ot-maler">
        {malerFor(retning).map((m) => (
          <button
            type="button"
            key={m.id}
            className={`ot-mal${m.id === malId ? " valgt" : ""}`}
            onClick={() => onEndre(m.id)}
          >
            <Miniatyr mal={m} liggende={retning === "liggende"} />
            <span>{m.navn}</span>
          </button>
        ))}
      </div>
    </Skjemafelt>
  );
}

/** Malens inndeling i miniatyr: hovedfeltet mørkere, sidefeltene lysere, stripen nederst. */
function Miniatyr({ mal, liggende }: { mal: Mal; liggende: boolean }) {
  const bredde = mal.omrader[0]!.split(" ").length;
  const stil: CSSProperties = {
    gridTemplateColumns: mal.kolonner,
    gridTemplateRows: `${mal.rader} 0.25fr`,
    gridTemplateAreas: [...mal.omrader, Array(bredde).fill(STRIPE).join(" ")].map((r) => `'${r}'`).join(" "),
    aspectRatio: liggende ? "16 / 9" : "9 / 16",
    // Stående: høyden styrer, ellers blir miniatyren en meter lang i en smal kolonne.
    ...(liggende ? { width: "100%" } : { height: "90px", width: "auto" }),
  };
  return (
    <span className="ot-miniatyr" style={stil} aria-hidden>
      {[...mal.soner, STRIPE].map((s) => (
        <i key={s} style={{ gridArea: s }} className={s === "a" ? "hoved" : ""} />
      ))}
    </span>
  );
}
