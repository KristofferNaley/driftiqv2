"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/klient";
import { Knapperad, Modal, Tekstfelt, Tekstomrade, useSending } from "@/components/skjema";
import { Ramme } from "../ramme";

/**
 * HMS-malene — spørsmålslistene for vernerunde og risikovurdering.
 *
 * Plattformdata: samme mal for alle borettslag. Kunden velger hvilken mal de bruker, men
 * kan ikke endre punktene. Poenget er at en vernerunde skal kunne sammenlignes på tvers av
 * kunder og over tid — endret hver kunde sin egen liste, var det ikke lenger samme runde.
 *
 * Endringer her slår IKKE tilbake på gjennomførte runder. De kopierer punktteksten sin ved
 * utkvittering, av samme grunn som `CompletionChecklistResult` gjør det.
 */

const TYPER = [
  { nokkel: "vernerunde", etikett: "Vernerunde" },
  { nokkel: "risikovurdering", etikett: "Risikovurdering" },
] as const;

type Maltype = (typeof TYPER)[number]["nokkel"];

type Mal = {
  id: string;
  templateType: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  active: boolean;
};

type Punkt = { id: string; text: string; hint: string | null; order: number };
type Kategori = { id: string; key: string; label: string; order: number; punkter: Punkt[] };
type MalDetalj = Mal & { kategorier: Kategori[] };

export default function Maler() {
  const [type, setType] = useState<Maltype>("vernerunde");
  const [maler, setMaler] = useState<Mal[] | null>(null);
  const [valgt, setValgt] = useState<string | null>(null);
  const [detalj, setDetalj] = useState<MalDetalj | null>(null);
  const [feil, setFeil] = useState<string | null>(null);
  const [nyMal, setNyMal] = useState(false);

  const lastListe = useCallback(async () => {
    try {
      const rader = await api.hent<Mal[]>(`/templates?type=${type}`);
      setMaler(rader);
      // Velg den første automatisk — en tom høyreside ved sidelast ser ut som en feil.
      setValgt((v) => (v && rader.some((m) => m.id === v) ? v : (rader[0]?.id ?? null)));
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke hente malene");
    }
  }, [type]);

  const lastDetalj = useCallback(async () => {
    if (!valgt) {
      setDetalj(null);
      return;
    }
    try {
      setDetalj(await api.hent<MalDetalj>(`/templates/${valgt}`));
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke hente malen");
    }
  }, [valgt]);

  useEffect(() => {
    void lastListe();
  }, [lastListe]);
  useEffect(() => {
    void lastDetalj();
  }, [lastDetalj]);

  async function endreMal(id: string, kropp: Record<string, unknown>) {
    setFeil(null);
    try {
      await api.endre(`/templates/${id}`, kropp);
      await lastListe();
      await lastDetalj();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke lagre");
    }
  }

  return (
    <Ramme tittel="HMS-maler">
      {feil && <div className="feilmelding">{feil}</div>}

      <div className="pf-faner">
        {TYPER.map((t) => (
          <button
            key={t.nokkel}
            className={`pf-fane${type === t.nokkel ? " valgt" : ""}`}
            onClick={() => setType(t.nokkel)}
          >
            {t.etikett}
          </button>
        ))}
      </div>

      <div className="pf-mal-layout">
        <div className="pf-kort">
          <div className="pf-kort-hode">
            <span>Maler</span>
            <button className="btn btn-primary" onClick={() => setNyMal(true)}>
              ＋ Ny
            </button>
          </div>
          {!maler ? (
            <p className="pf-dempet" style={{ padding: "16px" }}>
              Henter …
            </p>
          ) : maler.length === 0 ? (
            <p className="pf-dempet" style={{ padding: "16px" }}>
              Ingen maler for {TYPER.find((t) => t.nokkel === type)!.etikett.toLowerCase()} ennå.
            </p>
          ) : (
            maler.map((m) => (
              <button
                key={m.id}
                className={`pf-mal-rad${valgt === m.id ? " valgt" : ""}`}
                onClick={() => setValgt(m.id)}
              >
                <span style={{ minWidth: 0 }}>
                  <span className="pf-navn">{m.name}</span>
                  {m.description && <span className="pf-under">{m.description}</span>}
                </span>
                <span>
                  {m.isDefault && <span className="pf-merkelapp aktiv">Standard</span>}
                  {!m.active && <span className="pf-merkelapp utgatt">Av</span>}
                </span>
              </button>
            ))
          )}
        </div>

        {detalj ? (
          <MalDetaljvisning
            mal={detalj}
            onEndreMal={endreMal}
            onEndret={async () => {
              await lastDetalj();
            }}
            onFeil={setFeil}
          />
        ) : (
          <div className="pf-kort">
            <p className="pf-dempet" style={{ padding: "16px" }}>
              Velg en mal til venstre.
            </p>
          </div>
        )}
      </div>

      {nyMal && (
        <NyMalModal
          type={type}
          onLukk={() => setNyMal(false)}
          onLagret={() => {
            setNyMal(false);
            void lastListe();
          }}
        />
      )}
    </Ramme>
  );
}

function MalDetaljvisning({
  mal,
  onEndreMal,
  onEndret,
  onFeil,
}: {
  mal: MalDetalj;
  onEndreMal: (id: string, kropp: Record<string, unknown>) => Promise<void>;
  onEndret: () => Promise<void>;
  onFeil: (f: string | null) => void;
}) {
  const [nyKategori, setNyKategori] = useState("");
  const [nyttPunkt, setNyttPunkt] = useState<{ kategoriId: string; tekst: string } | null>(null);

  async function kjor(handling: () => Promise<unknown>, feiltekst: string) {
    onFeil(null);
    try {
      await handling();
      await onEndret();
    } catch (e) {
      onFeil(e instanceof Error ? e.message : feiltekst);
    }
  }

  const antallPunkter = mal.kategorier.reduce((n, k) => n + k.punkter.length, 0);

  return (
    <div>
      <div className="pf-kort">
        <div className="pf-kort-hode">
          <span>{mal.name}</span>
          <span style={{ display: "flex", gap: "6px" }}>
            <button
              className="btn btn-ghost"
              disabled={mal.isDefault}
              title={
                mal.isDefault
                  ? "Dette er allerede standardmalen"
                  : "Gjør denne til standard for nye runder"
              }
              onClick={() => void onEndreMal(mal.id, { isDefault: true })}
            >
              Sett som standard
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => void onEndreMal(mal.id, { active: !mal.active })}
            >
              {mal.active ? "Slå av" : "Slå på"}
            </button>
          </span>
        </div>
        <div className="pf-kort-kropp">
          <p className="pf-tekst">
            {mal.kategorier.length} kategori{mal.kategorier.length === 1 ? "" : "er"} ·{" "}
            {antallPunkter} punkt{antallPunkter === 1 ? "" : "er"}
          </p>
          {!mal.active && (
            <p className="pf-tekst">
              Malen er slått av og kan ikke velges for nye runder. Runder som allerede bruker
              den, står urørt.
            </p>
          )}
        </div>
      </div>

      {mal.kategorier.map((k) => (
        <div key={k.id} className="pf-kort">
          <div className="pf-kort-hode">
            <span>{k.label}</span>
            <button
              className="btn btn-ghost"
              onClick={() =>
                void kjor(
                  () => api.slett(`/templates/categories/${k.id}`),
                  "Kunne ikke slette kategorien",
                )
              }
            >
              Slett kategori
            </button>
          </div>
          {k.punkter.map((p) => (
            <div key={p.id} className="pf-punkt-rad">
              <span style={{ minWidth: 0 }}>
                <span>{p.text}</span>
                {p.hint && <span className="pf-under">{p.hint}</span>}
              </span>
              <button
                className="btn btn-ghost"
                aria-label={`Slett punktet «${p.text}»`}
                onClick={() =>
                  void kjor(() => api.slett(`/templates/items/${p.id}`), "Kunne ikke slette punktet")
                }
              >
                Slett
              </button>
            </div>
          ))}

          {nyttPunkt?.kategoriId === k.id ? (
            <form
              className="pf-punkt-rad"
              onSubmit={(e) => {
                e.preventDefault();
                const tekst = nyttPunkt.tekst.trim();
                if (!tekst) return;
                setNyttPunkt(null);
                void kjor(
                  () =>
                    api.send(`/templates/categories/${k.id}/items`, {
                      text: tekst,
                      order: k.punkter.length,
                    }),
                  "Kunne ikke legge til punktet",
                );
              }}
            >
              <input
                className="input"
                autoFocus
                placeholder="Hva skal kontrolleres?"
                aria-label="Nytt punkt"
                value={nyttPunkt.tekst}
                onChange={(e) => setNyttPunkt({ kategoriId: k.id, tekst: e.target.value })}
              />
              <button className="btn btn-primary">Legg til</button>
            </form>
          ) : (
            <div className="pf-punkt-rad">
              <button
                className="btn btn-ghost"
                onClick={() => setNyttPunkt({ kategoriId: k.id, tekst: "" })}
              >
                ＋ Nytt punkt
              </button>
            </div>
          )}
        </div>
      ))}

      <div className="pf-kort">
        <form
          className="pf-punkt-rad"
          onSubmit={(e) => {
            e.preventDefault();
            const navn = nyKategori.trim();
            if (!navn) return;
            setNyKategori("");
            void kjor(
              () =>
                api.send(`/templates/${mal.id}/categories`, {
                  // Nøkkelen utledes av navnet — den er en teknisk identifikator ingen
                  // skriver for hånd, og et menneske skal ikke måtte finne på den.
                  key: navn
                    .toLowerCase()
                    .replace(/æ/g, "ae")
                    .replace(/ø/g, "o")
                    .replace(/å/g, "a")
                    .replace(/[^a-z0-9]+/g, "_")
                    .replace(/^_|_$/g, ""),
                  label: navn,
                  order: mal.kategorier.length,
                }),
              "Kunne ikke legge til kategorien",
            );
          }}
        >
          <input
            className="input"
            placeholder="Ny kategori, f.eks. «Brannvern»"
            aria-label="Ny kategori"
            value={nyKategori}
            onChange={(e) => setNyKategori(e.target.value)}
          />
          <button className="btn btn-primary" disabled={!nyKategori.trim()}>
            Legg til kategori
          </button>
        </form>
      </div>
    </div>
  );
}

function NyMalModal({
  type,
  onLukk,
  onLagret,
}: {
  type: Maltype;
  onLukk: () => void;
  onLagret: () => void;
}) {
  const [navn, setNavn] = useState("");
  const [beskrivelse, setBeskrivelse] = useState("");
  const { sender, feil, send } = useSending(onLagret);

  return (
    <Modal tittel="Ny mal" onLukk={onLukk}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(() =>
            api.send("/templates", {
              templateType: type,
              name: navn.trim(),
              description: beskrivelse.trim() || null,
            }),
          );
        }}
      >
        {feil && <div className="feilmelding">{feil}</div>}
        <Tekstfelt etikett="Navn *" verdi={navn} onEndre={setNavn} />
        <Tekstomrade etikett="Beskrivelse" verdi={beskrivelse} onEndre={setBeskrivelse} />
        <p className="field-note">
          Malen opprettes tom. Legg til kategorier og punkter etterpå — den blir ikke standard
          før du setter den til det.
        </p>
        <Knapperad onAvbryt={onLukk} sendEtikett="Opprett mal" sender={sender} deaktivert={!navn.trim()} />
      </form>
    </Modal>
  );
}
