# Flujo de implementación

Antes de cambiar código, lee [AGENTS.md](../../AGENTS.md), [README.md](README.md), el plan de [features.md](features.md) y el límite de red en [scanner-safety.md](scanner-safety.md). Revisa también los tests y archivos de configuración que consumen el comportamiento afectado.

## Verificación local

Requisitos: Node `26.13.0`, pnpm `12.5.1` y lockfile vigente.

```sh
pnpm install --frozen-lockfile
pnpm ci:verify quality
```

La suite PostgreSQL requiere un cluster temporal dedicado en loopback:

```sh
DS_TEST_POSTGRES_ISOLATED=1 \
DS_TEST_DATABASE_URL=postgresql://postgres:...@127.0.0.1:5432/development_security_test_admin \
pnpm ci:verify postgres
```

La suite puede crear y borrar roles/base de datos dentro del cluster indicado. No uses una instancia compartida o productiva.

## Gates de CI

`.github/workflows/ci.yml` ejecuta políticas, lint, typecheck, tests, build, pruebas PostgreSQL aisladas, smoke de la imagen de API y auditoría de dependencias. No despliega a producción ni escanea dominios públicos. El smoke ejecuta el contenedor contra una base y certificados sintéticos en una red aislada.

## Alcance del trabajo

Una tarea de código no autoriza una exploración de red real ni una alteración de una base productiva. Mantén los tests con fixtures y loopback. El escaneo solo podrá activarse después de cerrar los gates de [scanner-safety.md](scanner-safety.md), demostrar límites de recursos y documentar una aprobación operativa separada.
