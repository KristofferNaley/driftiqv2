import { redirect } from "next/navigation";

/** Flyttet til Innstillinger (01.10.2026). Ruta beholdes så gamle lenker og bokmerker virker. */
export default function Omdirigering() {
  redirect("/plattform/innstillinger/prismodell");
}
