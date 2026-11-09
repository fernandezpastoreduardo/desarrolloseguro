FROM node:26.13.0-trixie-slim AS node-base

WORKDIR /workspace

FROM node-base AS pnpm-base

RUN npm install --global pnpm@12.5.1

FROM pnpm-base AS development

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/desarrollo-seguro/api/package.json apps/desarrollo-seguro/api/package.json
COPY apps/desarrollo-seguro/core/package.json apps/desarrollo-seguro/core/package.json
COPY apps/desarrollo-seguro/persistence/package.json apps/desarrollo-seguro/persistence/package.json
COPY apps/desarrollo-seguro/web/package.json apps/desarrollo-seguro/web/package.json
COPY apps/desarrollo-seguro/worker/package.json apps/desarrollo-seguro/worker/package.json
RUN pnpm install --frozen-lockfile

COPY . .
RUN chown -R node:node /workspace

USER node

EXPOSE 3001 5173

FROM development AS development-security-build

RUN pnpm --filter @desarrolloseguro/api build \
  && pnpm --filter @desarrolloseguro/web build

FROM pnpm-base AS development-security-production-dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/desarrollo-seguro/api/package.json apps/desarrollo-seguro/api/package.json
COPY apps/desarrollo-seguro/core/package.json apps/desarrollo-seguro/core/package.json
COPY apps/desarrollo-seguro/persistence/package.json apps/desarrollo-seguro/persistence/package.json
COPY apps/desarrollo-seguro/web/package.json apps/desarrollo-seguro/web/package.json
COPY apps/desarrollo-seguro/worker/package.json apps/desarrollo-seguro/worker/package.json
RUN pnpm install --prod --filter @desarrolloseguro/api... --frozen-lockfile --ignore-scripts

FROM node-base AS development-security-production

ENV NODE_ENV=production \
    DS_API_PORT=3001 \
    DS_API_TLS_REQUIRED=true \
    DS_DATABASE_URL_FILE_REQUIRED=true \
    DS_DATABASE_TLS_REQUIRED=true

COPY --from=development-security-production-dependencies --chown=node:node /workspace/node_modules /workspace/node_modules
COPY --from=development-security-production-dependencies --chown=node:node /workspace/apps/desarrollo-seguro/api/node_modules /workspace/apps/desarrollo-seguro/api/node_modules
COPY --from=development-security-production-dependencies --chown=node:node /workspace/apps/desarrollo-seguro/persistence/node_modules /workspace/apps/desarrollo-seguro/persistence/node_modules
COPY --from=development-security-production-dependencies /workspace/apps/desarrollo-seguro/api/package.json /workspace/apps/desarrollo-seguro/api/package.json
COPY --from=development-security-production-dependencies /workspace/apps/desarrollo-seguro/core/package.json /workspace/apps/desarrollo-seguro/core/package.json
COPY --from=development-security-production-dependencies /workspace/apps/desarrollo-seguro/persistence/package.json /workspace/apps/desarrollo-seguro/persistence/package.json
COPY --from=development-security-build --chown=node:node /workspace/apps/desarrollo-seguro/api/dist /workspace/apps/desarrollo-seguro/api/dist
COPY --from=development-security-build --chown=node:node /workspace/apps/desarrollo-seguro/core/dist /workspace/apps/desarrollo-seguro/core/dist
COPY --from=development-security-build --chown=node:node /workspace/apps/desarrollo-seguro/persistence/dist /workspace/apps/desarrollo-seguro/persistence/dist
COPY --chown=node:node apps/desarrollo-seguro/persistence/migrations /workspace/apps/desarrollo-seguro/persistence/migrations

USER node

EXPOSE 3001

CMD ["node", "apps/desarrollo-seguro/api/dist/main.js"]

FROM nginx:1.30-alpine AS development-security-web

COPY docker/nginx-development-security.conf /etc/nginx/conf.d/default.conf
COPY --from=development-security-build /workspace/apps/desarrollo-seguro/web/dist /usr/share/nginx/html/app
COPY --from=development-security-build /workspace/desarrollo-seguro /usr/share/nginx/html/desarrollo-seguro

USER 101:101

EXPOSE 8080
