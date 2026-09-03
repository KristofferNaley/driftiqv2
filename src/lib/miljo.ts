/**
 * Hvilket miljø dette er — utledet av `VERT_APP`, ikke en egen variabel.
 *
 * Testmiljøet heter `test.driftiq.no` (CLAUDE.md), og det er den ene forskjellen som
 * skal styre alt som SER annerledes ut i test: PWA-ikonene med «TEST»-bånd, manifestets
 * navn og merket ved logoen. En egen env-variabel ville vært én ting til å huske å sette
 * — og glemmes den, ser test ut som prod på hjemskjermen, som er nøyaktig forvekslingen
 * dette skal hindre. Leses kun på serveren (`process.env` finnes ikke i nettleseren).
 */
export const ER_TESTMILJO = /^test[.-]/i.test(process.env.VERT_APP ?? "");
