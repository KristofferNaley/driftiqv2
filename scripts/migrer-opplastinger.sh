#!/bin/sh
# Kopierer opplastede filer fra v1s uploads-volum til v2s.
#
#   scripts/migrer-opplastinger.sh <v1-volum> <v2-volum>
#   scripts/migrer-opplastinger.sh driftiq-test_uploads_test_data driftiqv2_uploads
#
# v1 lagrer avviksvedlegg, utførelsesbilder og kontraktfiler NØSTET (deviations/{devId}/fil,
# completions/{cid}/fil, contracts/{cid}/fil); v2 leser dem FLATT (deviations/fil) — de
# flates derfor ut ett nivå. Filnavnene er uuid-baserte, så det kan ikke kollidere. Alt annet kopieres
# med samme sti. Eksisterende filer i v2 røres aldri, og v1-volumet monteres skrivebeskyttet
# — skriptet er trygt å kjøre om igjen.
#
# Radene hører til: kjør også migreringen for tabellene (fila uten raden er usynlig):
#   docker run --rm --network edge --env-file .env -e DATABASE_URL_V1=... -v "$PWD:/app" \
#     -w /app node:22-alpine npx tsx scripts/migrer-fra-v1.ts \
#     --tabeller=deviation_attachments,completion_photos
set -eu

V1_VOLUM=${1:?Bruk: migrer-opplastinger.sh <v1-volum> <v2-volum>}
V2_VOLUM=${2:?Bruk: migrer-opplastinger.sh <v1-volum> <v2-volum>}

docker run --rm -v "$V1_VOLUM":/v1:ro -v "$V2_VOLUM":/v2 alpine sh -c '
  [ -d /v1/orgs ] || { echo "Fant ikke orgs/ i v1-volumet"; exit 1; }
  find /v1/orgs -type f | while read -r fil; do
    rel=${fil#/v1/orgs/}                 # {org}/{modul}[/{undermappe}]/{filnavn}
    org=${rel%%/*}
    rest=${rel#*/}
    modul=${rest%%/*}
    case "$modul" in
      # v1s profilmappe rommer dashbordbanneret, som v2 leser fra `org/` (se filSti(…, "org")
      # i lib/lagring.ts). Raden peker på filnavnet — flyttes ikke fila, viser innstillingene
      # et banner som gir 404. v1s logo ligger i samme mappe og blir med som en foreldreløs
      # fil på noen titalls kB: skriptet ser bare volumet, ikke databasen, og en logo på
      # avveie er billigere enn et banner som mangler.
      profil) maal="/v2/orgs/$org/org/$(basename "$fil")" ;;
      # Nøstet i v1, flatt i v2.
      deviations|completions|contracts) maal="/v2/orgs/$org/$modul/$(basename "$fil")" ;;
      *) maal="/v2/orgs/$rel" ;;
    esac
    if [ ! -f "$maal" ]; then
      mkdir -p "$(dirname "$maal")"
      cp "$fil" "$maal"
      echo "kopiert: $rel"
    fi
  done
  echo "Ferdig."
'
