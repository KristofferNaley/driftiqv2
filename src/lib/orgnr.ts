/**
 * Organisasjonsnummer. **Ingen importer** — brukes både i API-et og i nettleseren.
 */

/**
 * Norsk organisasjonsnummer er ni siffer, vist i grupper på tre: «938 765 432».
 * Lagres uten mellomrom.
 *
 * Verdier som ikke er ni siffer vises UENDRET — et halvskrevet nummer skal ikke bli stille
 * omformet til noe som ser riktig ut.
 */
export function formatOrgNr(nr: string | null | undefined): string | null {
  if (!nr) return null;
  const d = String(nr).replace(/\D/g, "");
  if (d.length !== 9) return nr;
  return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
}
