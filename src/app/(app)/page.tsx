"use client";

import Layout from "@/components/Layout";
import { useOkt } from "@/components/OktProvider";

/** Plassholder. Dashbordet portes når widgetene har moduler å hente fra. */
export default function Dashbord() {
  const { bruker, aktivOrg } = useOkt();
  return (
    <Layout tittel="Dashbord">
      <div className="page-content">
        <div className="card">
          <div className="card-header">
            <div className="card-title">{aktivOrg?.name ?? "Ingen organisasjon"}</div>
          </div>
          <div className="card-body" style={{ color: "var(--muted)", lineHeight: 1.6 }}>
            Innlogget som {bruker?.name}. Parkering er den første porterte modulsiden — se
            menyen til venstre.
          </div>
        </div>
      </div>
    </Layout>
  );
}
