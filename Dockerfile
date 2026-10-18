# syntax=docker/dockerfile:1.7
# Image de production de SYSTELEC SAMA-SHOP (voir docs/04-mise-en-service.md).
#   docker build --target app   -t systelec-sama-shop:<version> .   → serveur web (non-root, standalone)
#   docker build --target tools -t systelec-sama-shop-tools:<version> . → migrations, données de base,
#     premier administrateur, tâche planifiée (pnpm orders:expire)
# Aucun secret n'est intégré à l'image : la configuration est fournie à l'exécution (variables d'environnement).

ARG NODE_IMAGE=node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1

FROM ${NODE_IMAGE} AS base
RUN npm install -g pnpm@12.9.1 && apk add --no-cache libc6-compat
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ─── Dépendances (couche réutilisée tant que le verrou ne change pas) ─────────
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml prisma.config.ts ./
COPY prisma ./prisma
# Valeur fictive pour « prisma generate » (postinstall) : aucune connexion n'est ouverte.
RUN DATABASE_URL=postgresql://construction:construction@localhost:5432/construction pnpm install --frozen-lockfile

# ─── Construction ─────────────────────────────────────────────────────────────
FROM deps AS build
COPY . .
# Droits indépendants de ceux de l'hôte : sources lisibles par les utilisateurs non-root (node, nextjs).
RUN find /app -path /app/node_modules -prune -o -exec chmod a+rX {} +
# Valeurs fictives limitées à cette commande (jamais écrites dans l'image) : la configuration est validée
# au chargement des modules ; toutes les pages sont rendues à la demande, aucune donnée n'est figée.
RUN NEXT_OUTPUT=standalone APP_ENV=production APP_URL=https://construction.invalid \
    DATABASE_URL=postgresql://construction:construction@127.0.0.1:1/construction \
    AUTH_SECRET=construction-uniquement-jamais-utilise-a-l-execution \
    pnpm build

# ─── Outils d'exploitation (migrations, seed, tâche planifiée) ────────────────
FROM build AS tools
ENV NODE_ENV=production
USER node
CMD ["pnpm", "db:deploy"]

# ─── Serveur web ──────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS app
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 STORAGE_LOCAL_DIR=/app/storage
# npm et corepack (fournis avec l'image Node) ne servent pas à l'exécution : retirés, ils ne portent plus
# leurs dépendances vulnérables (analyse Trivy, phase 10). Paquets Alpine mis à jour (correctifs de sécurité).
RUN apk upgrade --no-cache \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
       /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
    && addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs \
    && mkdir -p /app/storage /app/.next/cache && chown nextjs:nodejs /app/storage /app/.next/cache
# Code en lecture seule pour l'utilisateur du service ; seuls les fichiers téléversés et le cache sont modifiables.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
VOLUME ["/app/storage"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server.js"]
