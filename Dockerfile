# Imagen de producción de «El laboratorio de las cosas cotidianas»: una sola instancia que sirve el frontend compilado, la API y
# Socket.IO desde el mismo origen (SPECS 7.4). SQLite vive en /data: monta ahí un VOLUMEN persistente o se pierde con cada despliegue.

FROM node:24-bookworm-slim AS build
WORKDIR /app
# better-sqlite3 es un módulo nativo: si no hay binario precompilado para esta plataforma se compila, y para eso hacen falta estas
# herramientas. Solo viven en esta etapa; la imagen final copia el resultado ya compilado.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
# Primero las dependencias: se reutilizan mientras no cambien package.json ni el lockfile.
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Valida el contenido y el mapa y compila el frontend. (Los tipos y las pruebas se comprueban en CI, no al construir la imagen.)
RUN npm run validate:project && npx vite build
# El servidor corre con tsx desde el código fuente: solo hacen falta las dependencias de producción.
RUN npm prune --omit=dev

FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    DATABASE_PATH=/data/laboratorio.sqlite \
    TRUST_PROXY=1
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/shared ./shared
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/package.json /app/tsconfig.json /app/tsconfig.node.json ./
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "--import", "tsx", "server/src/index.ts"]
