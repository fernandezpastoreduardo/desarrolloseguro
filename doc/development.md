# Desarrollo local

## Requisitos

- Node.js 26.13.1 (`.nvmrc`) y pnpm 12.5.1.
- Docker Engine/Desktop con Docker Compose.
- Para verificaciones PostgreSQL: instancia local y dedicada de PostgreSQL 19 con pgvector 0.8.7.

Instala dependencias y arranca la aplicación:

```sh
pnpm install
pnpm dev
```

Para ejecutar la pila contenerizada independiente, consulta [Producción](production.md). Compose publica únicamente el frontend en `127.0.0.1:18080` por defecto; base de datos y API no publican puertos del host.

## Calidad

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`pnpm test:postgres` requiere `DS_TEST_POSTGRES_ISOLATED=1` y `DS_TEST_DATABASE_URL` apuntando a un cluster local dedicado. El test puede crear y eliminar bases y roles; no lo dirijas a datos compartidos o de producción.

Para el flujo TDD y el análisis estático privado con SonarQube local, consulta [Desarrollo guiado por pruebas](test-driven-development.md) y [SonarQube Community Build local](sonarqube-local.md).

## Identidad visual pública

Las páginas informativas y el portal `/app/` comparten el logotipo SVG local,
los tokens Sass de color, tipografía y espaciado, y no cargan recursos de
terceros. El portal mantiene su modo oscuro y sus estados de análisis, pero su
encabezado enlaza con la misma navegación pública. Las transiciones se
desactivan cuando el navegador solicita movimiento reducido.

La configuración del proyecto fija Node/pnpm en `package.json`, `.nvmrc` y `pnpm-lock.yaml`. CI usa las mismas versiones.
