"use client";

import { useEffect, useState } from "react";
import { Feil } from "@/components/felles";
import { Felt, Knapperad, Modal, Nedtrekk, Tekstfelt, useSending } from "@/components/skjema";
import { sokEnheter, type Enhet } from "@/lib/brreg";
import { leverandorer, type Leverandor } from "@/lib/klient";

/**
 * Ny leverandør — med oppslag i Enhetsregisteret mens man skriver firmanavnet.
 *
 * Samme mønster som kontaktskjemaet på landingssiden, og samme begrunnelse: navnet har man
 * i hodet, organisasjonsnummeret må man lete etter. Velger man et treff, følger org.nr. med
 * på kjøpet — nøkkelen som gjør leverandøren entydig på tvers av navnebytter og skrivemåter.
 *
 * Registeret er valgfritt med vilje: et enkeltpersonforetak naboen anbefalte skal kunne
 * legges inn selv om man ikke finner det, og søket feiler stille om registeret er nede.
 */
export default function NyLeverandorModal({
  orgId,
  onLukk,
  onOpprettet,
}: {
  orgId: string;
  onLukk: () => void;
  /** Får den nye leverandøren — kallstedet oppdaterer lista og kan åpne detaljen. */
  onOpprettet: (l: Leverandor) => Promise<void> | void;
}) {
  const [navn, setNavn] = useState("");
  const [valgt, setValgt] = useState<Enhet | null>(null);
  const [treff, setTreff] = useState<Enhet[]>([]);
  const [orgNr, setOrgNr] = useState("");
  const [relasjon, setRelasjon] = useState("avtale");
  const [fagfelt, setFagfelt] = useState("");

  const { sender, feil, send } = useSending(onLukk);

  // Duplikatvarsel FØR man trykker Opprett — API-et avviser uansett (409), men da har man
  // allerede fylt ut resten av skjemaet forgjeves.
  const [eksisterende, setEksisterende] = useState<Array<{ name: string; orgNumber: string | null }>>([]);
  useEffect(() => {
    void leverandorer
      .liste(orgId)
      .then((l) => setEksisterende(l.map((v) => ({ name: v.name, orgNumber: v.orgNumber }))))
      .catch(() => {});
  }, [orgId]);
  const rentOrgNr = orgNr.replace(/\s/g, "");
  const duplikat = rentOrgNr ? eksisterende.find((l) => l.orgNumber === rentOrgNr) : undefined;

  // 350 ms etter siste tastetrykk, aldri etter et valg — se kontaktskjemaet på landingssiden.
  useEffect(() => {
    if (valgt || navn.trim().length < 3) {
      setTreff([]);
      return;
    }
    let avbrutt = false;
    const t = setTimeout(() => {
      void sokEnheter(navn).then((res) => {
        if (!avbrutt) setTreff(res);
      });
    }, 350);
    return () => {
      avbrutt = true;
      clearTimeout(t);
    };
  }, [navn, valgt]);

  function velg(e: Enhet) {
    setValgt(e);
    setNavn(e.navn);
    setOrgNr(e.orgNr);
    setTreff([]);
  }

  return (
    <Modal tittel="Ny leverandør" onLukk={onLukk}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(async () => {
            const ny = await leverandorer.ny(orgId, {
              name: navn.trim(),
              orgNumber: orgNr.replace(/\s/g, "") || null,
              relationshipType: relasjon,
              category: fagfelt.trim() || null,
            });
            await onOpprettet(ny);
          });
        }}
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
      >
        <Feil melding={feil} />

        <Felt etikett="Firmanavn *" notat={valgt ? undefined : "Søker i Enhetsregisteret mens du skriver — velg et treff, så følger org.nr. med."}>
          <div className="brreg-sok">
            <input
              className="input"
              value={navn}
              autoComplete="off"
              placeholder="F.eks. «Bergen Rørleggerservice»"
              onChange={(e) => {
                setNavn(e.target.value);
                // Endres navnet etter et valg, gjelder ikke valget lenger.
                setValgt(null);
              }}
            />
            {treff.length > 0 && (
              <ul className="brreg-treff">
                {treff.map((e) => (
                  <li key={e.orgNr}>
                    <button type="button" onClick={() => velg(e)}>
                      <b>{e.navn}</b>
                      <em>{[e.orgForm, e.kommune, `Org.nr. ${e.orgNr}`].filter(Boolean).join(" · ")}</em>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {valgt && (
            <div className="field-note">
              {[valgt.orgForm, valgt.kommune, valgt.adresse].filter(Boolean).join(" · ")} — fra
              Enhetsregisteret.
            </div>
          )}
        </Felt>

        <Tekstfelt
          etikett="Organisasjonsnummer"
          verdi={orgNr}
          onEndre={setOrgNr}
          notat="Fylles ut av registertreffet, men kan settes selv."
        />
        {duplikat && (
          <Feil melding={`«${duplikat.name}» er allerede registrert med dette organisasjonsnummeret.`} />
        )}

        <Nedtrekk
          etikett="Relasjon"
          verdi={relasjon}
          onEndre={setRelasjon}
          valg={[
            { verdi: "avtale", etikett: "Faste leverandører" },
            { verdi: "handelskonto", etikett: "Innkjøpssteder" },
            { verdi: "adhoc", etikett: "Ved behov" },
          ]}
        />
        <Tekstfelt etikett="Fagfelt" verdi={fagfelt} onEndre={setFagfelt} plassholder="Rørlegger, elektriker, renhold …" />

        <Knapperad
          onAvbryt={onLukk}
          sendEtikett="Opprett leverandør"
          sender={sender}
          deaktivert={!navn.trim() || Boolean(duplikat)}
        />
      </form>
    </Modal>
  );
}
