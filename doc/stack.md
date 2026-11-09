# Stack

Desarrollo Seguro es un monorepo pnpm con paquetes por responsabilidad bajo `apps/desarrollo-seguro/`.

- Node.js `26.13.x`; pnpm `12.5.1`.
- TypeScript y NestJS para la API.
- React, Vite y TypeScript para la interfaz.
- PostgreSQL 17 con pgvector para persistencia.
- Docker Compose para ejecutar un stack independiente.

Las versiones de dependencias se fijan en `package.json` y `pnpm-lock.yaml`. La estructura y los comandos disponibles se definen en `pnpm-workspace.yaml` y los manifiestos de cada paquete.
