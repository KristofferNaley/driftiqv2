import { redirect } from "next/navigation";

/** Innstillinger har ingen egen forside — første underside er Prismodell. */
export default function Innstillinger() {
  redirect("/plattform/innstillinger/prismodell");
}
