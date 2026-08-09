import LoggInnSkjema from "./skjema";

/**
 * Innloggingssiden.
 *
 * Serverkomponent bare for å lese hvilken vert som er plattformpanelet. Verdien må komme
 * herfra og ikke fra en `NEXT_PUBLIC_`-variabel: sistnevnte bakes inn ved bygg, og da måtte
 * imaget bygges på nytt hver gang et domenenavn endres.
 */
export default function LoggInn() {
  return <LoggInnSkjema adminVert={process.env.VERT_ADMIN ?? null} />;
}
