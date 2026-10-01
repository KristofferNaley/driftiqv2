import type { ReactNode } from "react";

/** Overskrift og ingress for en underside i Innstillinger. Rammen og undermenyen står i layouten. */
export function Underside({
  tittel,
  ingress,
  children,
}: {
  tittel: string;
  ingress: string;
  children: ReactNode;
}) {
  return (
    <>
      <div className="pf-inst-hode">
        <h2>{tittel}</h2>
        <p className="pf-dempet">{ingress}</p>
      </div>
      {children}
    </>
  );
}
