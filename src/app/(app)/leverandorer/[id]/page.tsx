"use client";

import { use, useState } from "react";
import Link from "next/link";
import { ArrowLeft, KeyRound, UserPlus } from "lucide-react";
import Layout from "@/components/Layout";
import { Feil, Kort, Rad, Tom, dato, useOrgData } from "@/components/felles";
import { Avkryssing, Knapperad, Modal, Tekstfelt, Tekstomrade, useSending } from "@/components/skjema";
import { leverandorer } from "@/lib/klient";

export default function Leverandordetalj({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, feil, laster, last, orgId } = useOrgData((o) => leverandorer.hent(o, id), [id]);
  const [nyKontakt, setNyKontakt] = useState(false);
  const [nyttNotat, setNyttNotat] = useState(false);

  if (laster || !data) {
    return (
      <Layout tittel="Leverandør">
        <div className="page-content">
          <Feil melding={feil} />
          {!feil && <Tom tekst="Henter …" />}
        </div>
      </Layout>
    );
  }

  return (
    <Layout
      tittel={data.name}
      handlinger={
        <>
          <button className="btn btn-ghost" onClick={() => setNyKontakt(true)}>
            <UserPlus size={16} strokeWidth={2} aria-hidden />
            Ny kontakt
          </button>
          <button className="btn btn-primary" onClick={() => setNyttNotat(true)}>
            Nytt notat
          </button>
        </>
      }
    >
      <div className="page-content">
        <Link href="/leverandorer" className="list-meta" style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
          <ArrowLeft size={14} strokeWidth={2} aria-hidden /> Alle leverandører
        </Link>

        <Feil melding={feil} />

        <Kort tittel="Om leverandøren">
          <Rad tittel="Relasjon" hoyre={data.relationshipType} />
          <Rad tittel="Fagfelt" hoyre={data.category ?? "—"} />
          <Rad tittel="Organisasjonsnummer" hoyre={data.orgNumber ?? "—"} />
          <Rad tittel="Kundenummer" hoyre={data.customerNumber ?? "—"} />
          <Rad tittel="EHF" hoyre={data.ehf ? "Ja" : "Nei"} />
        </Kort>

        <Kort tittel="Kontaktpersoner">
          {data.kontakter.length === 0 ? (
            <Tom tekst="Ingen kontaktpersoner registrert." />
          ) : (
            // Primærkontakten sorteres først av API-et, og det finnes bare én.
            data.kontakter.map((k) => (
              <Rad
                key={k.id}
                tittel={k.name}
                meta={[k.role, k.phone, k.email].filter(Boolean).join(" · ")}
                hoyre={k.isPrimary ? <span className="badge info">Primær</span> : null}
              />
            ))
          )}
        </Kort>

        <Kort tittel="Adgangskontroll">
          {data.adgang.length === 0 ? (
            <Tom tekst="Ingen nøkler eller adgangskort utlevert." />
          ) : (
            data.adgang.map((a) => (
              <Rad
                key={a.id}
                tittel={
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                    <KeyRound size={14} strokeWidth={2} aria-hidden />
                    {a.title}
                  </span>
                }
                meta={a.issuedTo ? `utlevert til ${a.issuedTo}` : undefined}
                hoyre={<span className={`badge ${a.status === "innlevert" ? "ok" : "warn"}`}>{a.status}</span>}
              />
            ))
          )}
        </Kort>

        <Kort tittel="Notater">
          {data.notater.length === 0 ? (
            <Tom tekst="Ingen notater." />
          ) : (
            data.notater.map((n) => (
              <div key={n.id} style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)" }}>
                <div style={{ fontSize: "var(--fs-sm)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{n.text}</div>
                <div className="list-meta" style={{ marginTop: "6px" }}>
                  {n.authorName} · {dato(n.createdAt)}
                </div>
              </div>
            ))
          )}
        </Kort>
      </div>

      {nyKontakt && <NyKontakt orgId={orgId!} id={id} onLukk={() => setNyKontakt(false)} onLagret={last} />}
      {nyttNotat && <NyttNotat orgId={orgId!} id={id} onLukk={() => setNyttNotat(false)} onLagret={last} />}
    </Layout>
  );
}

function NyKontakt({ orgId, id, onLukk, onLagret }: { orgId: string; id: string; onLukk: () => void; onLagret: () => Promise<void> }) {
  const [navn, setNavn] = useState("");
  const [rolle, setRolle] = useState("");
  const [epost, setEpost] = useState("");
  const [telefon, setTelefon] = useState("");
  const [primar, setPrimar] = useState(false);
  const { sender, feil, send } = useSending(async () => {
    await onLagret();
    onLukk();
  });

  return (
    <Modal tittel="Ny kontaktperson" onLukk={onLukk}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(() =>
            leverandorer.nyKontakt(orgId, id, {
              name: navn,
              role: rolle || null,
              email: epost || null,
              phone: telefon || null,
              isPrimary: primar,
            }),
          );
        }}
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
      >
        <Feil melding={feil} />
        <Tekstfelt etikett="Navn" verdi={navn} onEndre={setNavn} />
        <Tekstfelt etikett="Rolle" verdi={rolle} onEndre={setRolle} plassholder="Vaktmester, daglig leder …" />
        <div className="field-row">
          <Tekstfelt etikett="E-post" type="email" verdi={epost} onEndre={setEpost} />
          <Tekstfelt etikett="Telefon" verdi={telefon} onEndre={setTelefon} />
        </div>
        <Avkryssing
          etikett="Primærkontakt"
          verdi={primar}
          onEndre={setPrimar}
          notat="Bare én om gangen. Settes denne, mister den forrige merket — og rutiner med «ring leverandøren» viser denne."
        />
        <Knapperad onAvbryt={onLukk} sender={sender} deaktivert={!navn.trim()} />
      </form>
    </Modal>
  );
}

function NyttNotat({ orgId, id, onLukk, onLagret }: { orgId: string; id: string; onLukk: () => void; onLagret: () => Promise<void> }) {
  const [tekst, setTekst] = useState("");
  const { sender, feil, send } = useSending(async () => {
    await onLagret();
    onLukk();
  });

  return (
    <Modal tittel="Nytt notat" onLukk={onLukk}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(() => leverandorer.nyttNotat(orgId, id, { text: tekst }));
        }}
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
      >
        <Feil melding={feil} />
        <Tekstomrade
          etikett="Notat"
          verdi={tekst}
          onEndre={setTekst}
          notat="Navnet ditt lagres med notatet og endres ikke senere, selv om du bytter navn."
        />
        <Knapperad onAvbryt={onLukk} sendEtikett="Lagre notat" sender={sender} deaktivert={!tekst.trim()} />
      </form>
    </Modal>
  );
}
