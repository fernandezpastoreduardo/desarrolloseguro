# Integración continua

El workflow [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) verifica cambios en pull requests y en `main`. Usa Node 26.13 y pnpm 12.5.1, instala con lockfile congelado, ejecuta calidad y pruebas PostgreSQL contra un servicio efímero, construye la imagen de la API y realiza un smoke aislado.

El workflow [`.github/workflows/deploy-development-security.yml`](../.github/workflows/deploy-development-security.yml) permite lanzar un despliegue manual desde `main`. Hay que marcar expresamente la casilla `deploy`; sin ella, el trabajo se omite. Se ejecuta en un runner GitHub-hosted efímero y requiere los secretos `DS_DEPLOY_HOST`, `DS_DEPLOY_SSH_KEY` y `DS_DEPLOY_KNOWN_HOSTS` en el environment `desarrollo-seguro-production`. La clave SSH solo permite ejecutar el gateway restringido de despliegue, que valida el comando, tamaño y rutas del archivo recibido antes de extraerlo en un release dedicado. El job comprueba HTTPS y la salud de la API después del despliegue.

El usuario SSH `dsdeploy` no tiene shell interactiva ni acceso a Docker. Su clave se restringe con `command=` y `restrict` en `authorized_keys`; el único comando permitido usa un gateway root-owned y sudoers limita `sudo` al gateway de recepción. La clave privada, la huella del host y el host solo se guardan en el environment dedicado. No configures secretos de otras aplicaciones en ese environment.

SonarQube Community Build se ejecuta solo en el equipo de desarrollo; GitHub Actions no intenta conectarse a `localhost` ni recibe sus análisis. La política de TDD y el flujo local están descritos en [test-driven-development.md](test-driven-development.md) y [sonarqube-local.md](sonarqube-local.md).

Comprobaciones locales:

```sh
pnpm install --frozen-lockfile
pnpm ci:verify
```

El paso PostgreSQL usa una base efímera del workflow. La auditoría de dependencias también forma parte del job. Los resultados de CI describen el commit probado; no acreditan un despliegue externo.
