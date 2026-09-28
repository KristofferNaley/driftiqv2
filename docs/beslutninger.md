# Tekniske beslutninger

Datert logg over valg der et åpenbart alternativ ble forkastet — ny avhengighet eller
tjeneste, endringer i RLS, auth, e-post eller bakgrunnsjobber. Nyeste øverst. Hver oppføring:
**hva** som ble valgt, **hvorfor**, og **alternativene** som ble vurdert.

Beslutninger fra før denne fila (28.09.2026) står der de ble tatt: `README.md` (arkitektur),
`CLAUDE.md` og notatene i `docs/`.

---

## 28.09.2026 — Egen krypteringsnøkkel for integrasjoner: `INTEGRASJON_NOKKEL`

**Hva:** Tokens og nøkler til Fiken, Easee og Unloc krypteres (AES-256-GCM,
`lib/kryptering.ts`) med én felles nøkkel fra `.env`, `INTEGRASJON_NOKKEL`. Den het
`FIKEN_TOKEN_KEY` fordi Fiken kom først; navnet fikk den til å se ut som kundens Fiken-token,
som legges inn i orginnstillingene. Omdøpt før prod fikk nøkkelen, så ingen overgang trengtes.

**Hvorfor:** Nøkkelen skal ligge utenfor databasen, slik at en dump eller backup alene ikke
gir tilgang til kundenes regnskap.

**Alternativer:**
- *Avlede fra `BETTER_AUTH_SECRET` (HKDF).* Forkastet: den byttes når innlogging kan være
  kompromittert, og da ville alle integrasjonskoblinger dødd samtidig. En lekkasje ville også
  gitt både sesjoner og regnskapstokens. `jwks`-raden er allerede kryptert med den (og veltet
  testmiljøet ved dump-seeding).
- *Lagre nøkkelen i innstillinger/databasen.* Forkastet: nøkkel og chiffer på samme sted.
- *Én nøkkel per integrasjon.* Forkastet: samme trusselbilde, mer å forvalte. Formatet
  `v1:…` tillater rotasjon senere.
