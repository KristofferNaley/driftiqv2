# Bygg og kjør v2. Speiler mønsteret i frontend/Dockerfile: bygg i én stage, kjør en slank.
#
# Merk at devDependencies BEHOLDES i kjørebildet. Det er et bevisst avvik fra en vanlig
# Next-Dockerfile: `tsx` trengs for å kjøre migrasjons- og oppstartsskriptet ved hver
# containerstart, og `vitest` trengs for å kjøre sikkerhetstestene DER de har en ekte
# Postgres — akkurat som v1-suiten kjøres inne i backend-containeren.
FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# OCR for tekstsøk i skannede dokumenter (docs/tekstsok.md): tesseract med norsk språkdata
# og poppler (pdftoppm) for å gjøre PDF-sider om til bilder. ~70 MB. Mangler de, hopper
# tekstuttrekket over OCR og merker dokumentet — appen kjører videre. Skriftpakken er
# nødvendig: uten fonter tegner pdftoppm PDF-er med ikke-innbakte skrifter som blanke sider
# («Couldn't find a font for 'Helvetica'»), og OCR-en leser ingenting.
# vips (oppslagstavla, lib/tavlebilder.ts): gjør opplastede bilder om til WebP og skalerer dem
# ned. `vips-heif` + `libheif-libde265` er det som leser HEIC fra iPhone.
RUN apk add --no-cache tesseract-ocr tesseract-ocr-data-nor poppler-utils fontconfig font-liberation \
    vips-tools vips-heif libheif-libde265

# Standalone-bygget tar med bare de modulene serveren faktisk bruker.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Migrasjoner, RLS-oppsett og tester kjøres fra containeren, så kildekoden må være med.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/tests ./tests
COPY --from=builder /app/package.json /app/tsconfig.json /app/vitest.config.ts /app/drizzle.config.ts ./

EXPOSE 3008
ENV PORT=3008 HOSTNAME=0.0.0.0

# Oppstartsskriptet er idempotent og MÅ kjøre før serveren tar imot trafikk — det er der
# approllen får passordet sitt og policyene legges på.
CMD ["sh", "-c", "npx tsx scripts/oppstart.ts && node server.js"]
