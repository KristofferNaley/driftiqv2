"use client";

import { useState } from "react";
import { UserPlus } from "lucide-react";
import Layout from "@/components/Layout";
import { useOkt } from "@/components/OktProvider";
import { Feil, Kort, Rad, Tom, dato, useOrgData } from "@/components/felles";
import { Knapperad, Modal, Nedtrekk, Tekstfelt, useSending } from "@/components/skjema";
import { brukere, type OrgBruker } from "@/lib/klient";

const NIVAER = [
  { verdi: "orgadmin", etikett: "Administrator" },
  { verdi: "redigering", etikett: "Redigering" },
  { verdi: "visning", etikett: "Visning" },
];

const NIVA_MERKE: Record<string, string> = {
  orgadmin: "info",
  redigering: "muted",
  visning: "muted",
};

/**
 * Brukere og tilgang.
 *
 * Tilgangen ligger på MEDLEMSKAPET, ikke på kontoen: samme person kan være administrator
 * her og ha visningstilgang i et annet lag. «Fjern» tar bort tilgangen til denne org-en —
 * kontoen består.
 */
export default function Brukere() {
  const { aktivOrg } = useOkt();
  const { data, feil, setFeil, laster, last, orgId } = useOrgData((o) => brukere.liste(o));
  const [inviterer, setInviterer] = useState(false);
  const [redigerer, setRedigerer] = useState<OrgBruker | null>(null);

  const liste = data ?? [];
  const erAdmin = aktivOrg?.nivaa === "orgadmin";

  async function fjern(b: OrgBruker) {
    if (!orgId) return;
    try {
      await brukere.fjern(orgId, b.id);
      await last();
    } catch (e) {
      // «Organisasjonen må ha minst én administrator» kommer hit.
      setFeil(e instanceof Error ? e.message : "Kunne ikke fjerne brukeren");
    }
  }

  return (
    <Layout
      tittel="Brukere"
      handlinger={
        erAdmin && (
          <button className="btn btn-primary" onClick={() => setInviterer(true)}>
            <UserPlus size={16} strokeWidth={2} aria-hidden />
            Inviter bruker
          </button>
        )
      }
    >
      <div className="page-content">
        <Feil melding={feil} />

        <Kort tittel={`Tilgang i ${aktivOrg?.name ?? "organisasjonen"}`}>
          {laster ? (
            <Tom tekst="Henter …" />
          ) : liste.length === 0 ? (
            <Tom tekst="Ingen brukere ennå." />
          ) : (
            liste.map((b) => (
              <Rad
                key={b.id}
                tittel={b.name}
                meta={[
                  b.email,
                  b.title,
                  b.lastLoginAt ? `sist inne ${dato(b.lastLoginAt)}` : "aldri logget inn",
                ]
                  .filter(Boolean)
                  .join(" · ")}
                hoyre={
                  <>
                    {/* Invitasjonen står ute til brukeren har satt passord — uten dette
                        venter styret på noen som aldri har kommet inn. */}
                    {!b.harSattPassord && <span className="badge warn">Ikke aktivert</span>}
                    {!b.active && <span className="badge muted">Deaktivert</span>}
                    {b.platformRole === "superadmin" && <span className="badge info">DriftIQ</span>}
                    <span className={`badge ${NIVA_MERKE[b.nivaa] ?? "muted"}`}>
                      {NIVAER.find((n) => n.verdi === b.nivaa)?.etikett ?? b.nivaa}
                    </span>
                    {erAdmin && (
                      <>
                        <button className="btn btn-ghost" onClick={() => setRedigerer(b)}>
                          Endre
                        </button>
                        <button className="btn btn-danger" onClick={() => fjern(b)}>
                          Fjern
                        </button>
                      </>
                    )}
                  </>
                }
              />
            ))
          )}
        </Kort>

        {!erAdmin && (
          <div className="field-note">
            Du har ikke administratortilgang i dette laget, så du kan se hvem som har tilgang,
            men ikke endre den.
          </div>
        )}
      </div>

      {inviterer && (
        <Inviter orgId={orgId!} onLukk={() => setInviterer(false)} onLagret={last} />
      )}
      {redigerer && (
        <EndreTilgang
          bruker={redigerer}
          orgId={orgId!}
          onLukk={() => setRedigerer(null)}
          onLagret={last}
        />
      )}
    </Layout>
  );
}

function Inviter({ orgId, onLukk, onLagret }: { orgId: string; onLukk: () => void; onLagret: () => Promise<void> }) {
  const [navn, setNavn] = useState("");
  const [epost, setEpost] = useState("");
  const [nivaa, setNivaa] = useState("visning");
  const [tittel, setTittel] = useState("");
  const { sender, feil, send } = useSending(async () => {
    await onLagret();
    onLukk();
  });

  return (
    <Modal tittel="Inviter bruker" onLukk={onLukk}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(() =>
            brukere.inviter(orgId, { name: navn, email: epost, role: nivaa, title: tittel || null }),
          );
        }}
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
      >
        <Feil melding={feil} />
        <Tekstfelt etikett="Navn" verdi={navn} onEndre={setNavn} />
        <Tekstfelt
          etikett="E-postadresse"
          type="email"
          verdi={epost}
          onEndre={setEpost}
          notat="Finnes adressen fra før, får den kontoen bare tilgang hit — én person skal ha én konto, ikke to."
        />
        <Tekstfelt etikett="Tittel" verdi={tittel} onEndre={setTittel} plassholder="Styreleder, vaktmester …" />
        <Nedtrekk
          etikett="Tilgangsnivå"
          verdi={nivaa}
          valg={NIVAER}
          onEndre={setNivaa}
          notat="Administrator ser også Brukere, Innstillinger og Fakturering. Tittelen styrer ingenting."
        />
        <div className="field-note">
          Brukeren får ingen passord fra deg. De må sette det selv via «glemt passord», slik at
          ingen andre enn dem kjenner det.
        </div>
        <Knapperad onAvbryt={onLukk} sendEtikett="Inviter" sender={sender} deaktivert={!navn.trim() || !epost.trim()} />
      </form>
    </Modal>
  );
}

function EndreTilgang({
  bruker,
  orgId,
  onLukk,
  onLagret,
}: {
  bruker: OrgBruker;
  orgId: string;
  onLukk: () => void;
  onLagret: () => Promise<void>;
}) {
  const [nivaa, setNivaa] = useState(bruker.nivaa);
  const [tittel, setTittel] = useState(bruker.title ?? "");
  const { sender, feil, send } = useSending(async () => {
    await onLagret();
    onLukk();
  });

  return (
    <Modal tittel={bruker.name} onLukk={onLukk}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(() => brukere.endre(orgId, bruker.id, { role: nivaa, title: tittel || null }));
        }}
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
      >
        <Feil melding={feil} />
        <Nedtrekk etikett="Tilgangsnivå" verdi={nivaa} valg={NIVAER} onEndre={setNivaa} />
        <Tekstfelt
          etikett="Tittel"
          verdi={tittel}
          onEndre={setTittel}
          notat="Ren beskrivelse. Fram til 08.08.2026 utledet v1 tilgang av tittelen — nå styrer den ingenting."
        />
        <Knapperad onAvbryt={onLukk} sender={sender} />
      </form>
    </Modal>
  );
}
