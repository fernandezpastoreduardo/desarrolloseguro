# Stack

Desarrollo Seguro es un monorepo pnpm con paquetes por responsabilidad bajo `apps/desarrollo-seguro/`.

- Node.js `26.13.1`; pnpm `12.5.1`.
- TypeScript y NestJS para la API.
- React, Vite y TypeScript para la interfaz.
- PostgreSQL 19 con pgvector 0.8.7 como destino de pruebas; producción conserva PG17 hasta completar el corte versionado.
- Docker Compose para ejecutar un stack independiente.

Las versiones de dependencias se fijan en `package.json` y `pnpm-lock.yaml`. La estructura y los comandos disponibles se definen en `pnpm-workspace.yaml` y los manifiestos de cada paquete.
