# Desarrollo Seguro

Desarrollo Seguro es una aplicación académica para observar controles técnicos visibles en sitios web y presentar evidencia con sus límites. No es una certificación ni sustituye una auditoría profesional. La fase actual ingiere y presenta informes de forma controlada; el escaneo automatizado completo todavía no está habilitado.

## Estructura

- `apps/desarrollo-seguro/web`: portal React y Vite.
- `apps/desarrollo-seguro/api`: API NestJS de solo lectura para informes públicos.
- `apps/desarrollo-seguro/core`: políticas y modelos compartidos por los paquetes DS.
- `apps/desarrollo-seguro/persistence`: PostgreSQL, migraciones y proyección de informes.
- `apps/desarrollo-seguro/worker`: componentes de ejecución del escáner; no se activa en el stack actual.
- `desarrollo-seguro/`: página informativa estática.
- `agentic-guidelines/desarrollo-seguro/`: contexto de producto, controles, operación y pruebas.
- `doc/`: guías para colaboradores y operadores.

## Requisitos

Node.js `26.13.1`, pnpm `12.5.1` y Docker Compose para la base local o el stack aislado.

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Las pruebas de integración PostgreSQL requieren una base desechable y estas variables:

```sh
DS_TEST_POSTGRES_ISOLATED=1
DS_TEST_DATABASE_URL=postgresql://...
pnpm test:postgres
```

Consulta [desarrollo local](doc/development.md), [verificación](doc/verification.md), [CI](doc/ci-cd.md), [operación del stack aislado](doc/production.md) y [migración major de PostgreSQL](doc/postgresql-major-upgrade.md).

## Stack Docker aislado

`compose.production.yaml` ejecuta la API, el portal web y PostgreSQL en contenedores y redes propios. Solo publica el portal en `127.0.0.1:18080`; la base de datos y la API no publican puertos al host. Un proxy externo puede dirigir el dominio elegido a ese puerto. El archivo no modifica ni depende de los contenedores o datos de otros proyectos.

El stack requiere secretos propios bajo `.secrets/`. No se guardan credenciales ni certificados en el repositorio. La preparación y los límites operativos se describen en [credenciales](doc/credentials.md) y [producción](doc/production.md).
