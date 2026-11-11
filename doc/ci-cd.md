# Integración continua

El workflow [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) verifica cambios en pull requests y en `main`. Usa Node 26.13 y pnpm 12.5.1, instala con lockfile congelado, ejecuta calidad y pruebas PostgreSQL contra un servicio efímero, construye y prueba la imagen de la API y audita dependencias.

El workflow [`.github/workflows/deploy-development-security.yml`](../.github/workflows/deploy-development-security.yml) es el flujo CI/CD manual desde `main`. Antes de permitir el deploy ejecuta las políticas, lint, typecheck, pruebas unitarias e integración, Playwright, sandbox, migraciones y `pnpm audit`. Luego construye las seis imágenes de producción (API, web, worker, coordinador, executor y broker de egress), ejecuta un smoke de API y escanea vulnerabilidades altas y críticas de sistema operativo y bibliotecas con Trivy. Los informes JSON del escáner se conservan como artefacto de Actions durante 14 días, incluso si el umbral de seguridad bloquea el job.

En `Actions > CI/CD Desarrollo Seguro > Run workflow`, selecciona `main`. La casilla `deploy` empieza desmarcada: marcada, el deploy solo comienza si todas las puertas anteriores pasan; sin marcar, el flujo ejecuta validaciones y análisis, pero no publica. El job de deploy se ejecuta en un runner GitHub-hosted efímero y requiere los secretos `DS_DEPLOY_HOST`, `DS_DEPLOY_SSH_KEY` y `DS_DEPLOY_KNOWN_HOSTS` en el environment `desarrollo-seguro-production`. La clave SSH solo permite ejecutar el gateway restringido de despliegue, que valida el comando, tamaño y rutas del archivo recibido antes de extraerlo en un release dedicado. Después comprueba HTTPS y la salud de la API con reintentos.

El usuario SSH `dsdeploy` no tiene shell interactiva ni acceso a Docker. Su clave se restringe con `command=` y `restrict` en `authorized_keys`; el único comando permitido usa un gateway root-owned y sudoers limita `sudo` al gateway de recepción. La clave privada, la huella del host y el host solo se guardan en el environment dedicado. No configures secretos de otras aplicaciones en ese environment.

SonarQube Community Build se ejecuta solo en el equipo de desarrollo; GitHub Actions no intenta conectarse a `localhost` ni recibe sus análisis. La política de TDD y el flujo local están descritos en [test-driven-development.md](test-driven-development.md) y [sonarqube-local.md](sonarqube-local.md).

Comprobaciones locales:

```sh
pnpm install --frozen-lockfile
pnpm ci:verify
```

El paso PostgreSQL usa una base efímera del workflow. Los resultados de CI describen el commit probado; solo un job `deploy` finalizado con éxito acredita que el gateway publicó ese commit y que respondieron la web y la API.
