# Mastra cere Node >= 22.13 (campul `engines` din @mastra/core).
FROM node:22-alpine AS build

WORKDIR /app

# Intai manifestele: stratul de dependinte se refoloseste cat timp ele nu se schimba.
COPY package.json package-lock.json* tsconfig.json ./
RUN npm ci

# Serverul e TypeScript si se compileaza in dist/. Browserul (src/) ramane JS pur,
# servit direct — de aceea nu trece pe aici.
COPY server ./server
RUN npm run build

FROM node:22-alpine

ENV NODE_ENV=production
# Nicio pornire locala n-are de ce sa trimita statistici de folosire.
ENV MASTRA_TELEMETRY_DISABLED=1
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY serve.js porturi.js sanatate.mjs index.html panze.html app.html ./
COPY src ./src
COPY test.mjs ./

USER node

# Toate trei porturile sunt declarate in imagine; care se foloseste efectiv depinde de
# `ROL`. Un container fara ROL le asculta pe toate, unul cu ROL — doar pe al lui.
EXPOSE 8080 8081 8082

# Proba intreaba portul PROPRIU, aflat din `porturi.js` — acelasi modul pe care il
# citeste si serverul. Cu o cifra scrisa aici, containerul „canvas" ar fi mereu
# „unhealthy": el nu asculta pe 8080.
HEALTHCHECK --interval=30s --timeout=4s --start-period=5s --retries=3 \
  CMD node sanatate.mjs

CMD ["node", "serve.js"]
