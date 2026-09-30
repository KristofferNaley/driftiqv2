"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import { Feil, Kort, Rad, Tom, initialer, useOrgData } from "@/components/felles";
import { Avkryssing, Felt as Skjemafelt, Modal, Nedtrekk, useSending } from "@/components/skjema";
import { oppslagstavle, type Tavlekontakt } from "@/lib/klient";
import { Bekreft } from "./felles";

/**
 * Kontaktpersonene i kontaktfeltet: DriftIQ-brukere i borettslaget. Navn, telefon og e-post
 * kommer fra profilen, rollen fra tittelen under Brukere — styret velger bare hvem og hva
 * som vises. De roterer på skjermen i rekkefølgen her. Uten noen vises borettslagets egen
 * telefon og e-post.
 */
export function Kontaktpersoner({
  orgId,
  kontakter,
  erAdmin,
  onEndret,
}: {
  orgId: string;
  kontakter: Tavlekontakt[];
  erAdmin: boolean;
  onEndret: () => void;
}) {
  const [skjema, setSkjema] = useState<Tavlekontakt | "ny" | null>(null);
  const [feil, setFeil] = useState<string | null>(null);

  async function utfor(handling: () => Promise<unknown>) {
    setFeil(null);
    try {
      await handling();
      onEndret();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Noe gikk galt");
    }
  }

  return (
    <Kort
      tittel="Kontaktpersoner på skjermen"
      handling={
        erAdmin && (
          <button className="btn btn-ghost btn-sm" onClick={() => setSkjema("ny")}>
            <Plus size={14} aria-hidden /> Legg til
          </button>
        )
      }
    >
      <div className="ot-felles">Gjelder hele borettslaget, ikke bare denne skjermen.</div>
      <Feil melding={feil} />
      {kontakter.length === 0 && (
        <Tom tekst="Ingen kontaktpersoner. Skjermen viser borettslagets telefon og e-post." />
      )}
      {kontakter.map((k, i) => (
        <Rad
          key={k.id}
          tittel={
            <span style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span className="ot-kontakt-mini">
                {k.harBilde ? <img src={`${oppslagstavle.kontaktbildeSti(orgId, k.id)}?v=${k.bildeVersjon}`} alt="" /> : initialer(k.navn)}
              </span>
              {k.navn}
              {k.rolle && <span className="field-note">{k.rolle}</span>}
            </span>
          }
          meta={
            [k.visTelefon && k.telefon, k.visEpost && k.epost].filter(Boolean).join(" · ") ||
            "Verken telefon eller e-post vises"
          }
          onClick={erAdmin ? () => setSkjema(k) : undefined}
          hoyre={
            erAdmin &&
            kontakter.length > 1 && (
              <>
                <button
                  className="btn btn-ghost btn-sm"
                  aria-label={`Flytt ${k.navn} opp`}
                  disabled={i === 0}
                  onClick={(e) => {
                    e.stopPropagation();
                    void utfor(() => oppslagstavle.flyttKontakt(orgId, k.id, "opp"));
                  }}
                >
                  <ArrowUp size={14} aria-hidden />
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  aria-label={`Flytt ${k.navn} ned`}
                  disabled={i === kontakter.length - 1}
                  onClick={(e) => {
                    e.stopPropagation();
                    void utfor(() => oppslagstavle.flyttKontakt(orgId, k.id, "ned"));
                  }}
                >
                  <ArrowDown size={14} aria-hidden />
                </button>
              </>
            )
          }
        />
      ))}
      {skjema && (
        <KontaktSkjema
          orgId={orgId}
          eksisterende={skjema === "ny" ? null : skjema}
          onLukk={() => setSkjema(null)}
          onLagret={() => {
            setSkjema(null);
            onEndret();
          }}
        />
      )}
    </Kort>
  );
}

function KontaktSkjema({
  orgId,
  eksisterende: e,
  onLukk,
  onLagret,
}: {
  orgId: string;
  eksisterende: Tavlekontakt | null;
  onLukk: () => void;
  onLagret: () => void;
}) {
  const { data: kandidater } = useOrgData((o) => oppslagstavle.kontaktkandidater(o));
  const [brukerId, setBrukerId] = useState(e?.brukerId ?? "");
  const [visTelefon, setVisTelefon] = useState(e?.visTelefon ?? true);
  const [visEpost, setVisEpost] = useState(e?.visEpost ?? false);
  const [fil, setFil] = useState<File | null>(null);
  const [fjernBilde, setFjernBilde] = useState(false);
  const [fjerner, setFjerner] = useState(false);
  const { sender, feil, send } = useSending(onLagret);
  const valgt = e ?? kandidater?.find((k) => k.id === brukerId) ?? null;
  const telefon = valgt?.telefon ?? null;
  const epost = valgt?.epost ?? null;

  return (
    <Modal tittel={e ? `Kontaktperson: ${e.navn}` : "Ny kontaktperson"} onLukk={onLukk}>
      <form
        onSubmit={(ev) => {
          ev.preventDefault();
          void send(async () => {
            if (!e) {
              if (!brukerId) throw new Error("Velg en person");
              return oppslagstavle.nyKontakt(orgId, { brukerId, visTelefon, visEpost }, fil);
            }
            await oppslagstavle.endreKontakt(orgId, e.id, { visTelefon, visEpost });
            if (fil) await oppslagstavle.settKontaktbilde(orgId, e.id, fil);
            else if (fjernBilde) await oppslagstavle.fjernKontaktbilde(orgId, e.id);
          });
        }}
      >
        {!e && (
          <Nedtrekk
            etikett="Person"
            verdi={brukerId}
            onEndre={setBrukerId}
            valg={[
              { verdi: "", etikett: kandidater ? "Velg en bruker …" : "Henter brukere …" },
              ...(kandidater ?? []).map((k) => ({ verdi: k.id, etikett: k.tittel ? `${k.navn}, ${k.tittel}` : k.navn })),
            ]}
            notat="Brukerne i borettslaget. Mangler noen, inviter dem under Brukere først."
          />
        )}
        {valgt && (
          <div className="field-note" style={{ marginBottom: "10px" }}>
            Rolle på skjermen: <b>{"rolle" in valgt ? (valgt.rolle ?? "ingen") : (valgt.tittel ?? "ingen")}</b>. Det er
            tittelen under Brukere, og endres der. Telefon og e-post er fra personens profil.
          </div>
        )}
        <Avkryssing
          etikett={`Vis telefon${telefon ? ` (${telefon})` : ""}`}
          verdi={visTelefon}
          onEndre={setVisTelefon}
          notat={valgt && !telefon ? "Profilen har ikke telefonnummer. Ingenting vises før det er lagt inn." : undefined}
        />
        <Avkryssing etikett={`Vis e-post${epost ? ` (${epost})` : ""}`} verdi={visEpost} onEndre={setVisEpost} />
        <Skjemafelt
          etikett="Bilde (valgfritt)"
          notat="Et portrett gjør det lettere for beboerne å kjenne igjen personen. Vises rundt på skjermen."
        >
          <input
            className="input"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(ev) => setFil(ev.target.files?.[0] ?? null)}
          />
        </Skjemafelt>
        {e?.harBilde && !fil && <Avkryssing etikett="Fjern bildet" verdi={fjernBilde} onEndre={setFjernBilde} />}
        <div className="field-note" style={{ marginBottom: "10px" }}>
          Navn, bilde og det du slår på over, vises offentlig i oppgangen. Legg bare inn personer som har sagt ja.
        </div>
        <Feil melding={feil} />
        <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
          {e ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setFjerner(true)}
            >
              Fjern
            </button>
          ) : (
            <span />
          )}
          <div style={{ display: "flex", gap: "10px" }}>
            <button type="button" className="btn btn-ghost" onClick={onLukk}>
              Avbryt
            </button>
            <button type="submit" className="btn btn-primary" disabled={sender}>
              {sender ? "Lagrer …" : "Lagre"}
            </button>
          </div>
        </div>
      </form>
      {fjerner && e && (
        <Bekreft
          tittel={`Fjerne ${e.navn}?`}
          etikett="Fjern"
          sender={sender}
          onAvbryt={() => setFjerner(false)}
          onBekreft={() => void send(() => oppslagstavle.slettKontakt(orgId, e.id))}
        >
          Personen forsvinner fra skjermene med en gang.
        </Bekreft>
      )}
    </Modal>
  );
}

