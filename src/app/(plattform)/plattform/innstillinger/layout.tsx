"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Ramme } from "../ramme";

/**
 * Innstillinger: det man setter opp sjelden og som gjelder hele plattformen (01.10.2026).
 *
 * Sidene lå før som seks egne menypunkter blant det man bruker daglig. De gamle stiene
 * (`/plattform/prismodell` osv.) omdirigerer hit, så bokmerker virker.
 *
 * Layout og ikke én side med faner: hver underside har egen URL, og rammen med undermenyen
 * blir stående når man bytter, uten ny henting av noe annet enn innholdet.
 */
const UNDERSIDER: ReadonlyArray<{ gruppe: string; sider: ReadonlyArray<{ sti: string; etikett: string }> }> = [
  {
    gruppe: "Forretning",
    sider: [
      { sti: "prismodell", etikett: "Prismodell" },
      { sti: "boligbyggelag", etikett: "Boligbyggelag" },
    ],
  },
  { gruppe: "Innhold", sider: [{ sti: "hms-maler", etikett: "HMS-maler" }] },
  {
    gruppe: "Varsler og tilgang",
    sider: [
      { sti: "varsler", etikett: "Varsler" },
      { sti: "plattformadmins", etikett: "Plattformadmins" },
      { sti: "innsynslogg", etikett: "Innsynslogg" },
    ],
  },
  { gruppe: "Teknisk", sider: [{ sti: "system", etikett: "System" }] },
];

export default function InnstillingerLayout({ children }: { children: ReactNode }) {
  const sti = usePathname();
  return (
    <Ramme tittel="Innstillinger">
      <div className="pf-inst">
        <nav className="pf-inst-meny" aria-label="Innstillinger">
          {UNDERSIDER.map((g) => (
            <div key={g.gruppe} className="pf-inst-gruppe">
              <div className="pf-inst-gruppenavn">{g.gruppe}</div>
              {g.sider.map((s) => {
                const href = `/plattform/innstillinger/${s.sti}`;
                const aktiv = sti === href || sti.startsWith(`${href}/`);
                return (
                  <Link
                    key={s.sti}
                    href={href}
                    className={`pf-inst-lenke${aktiv ? " aktiv" : ""}`}
                    aria-current={aktiv ? "page" : undefined}
                  >
                    {s.etikett}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="pf-inst-innhold">{children}</div>
      </div>
    </Ramme>
  );
}
