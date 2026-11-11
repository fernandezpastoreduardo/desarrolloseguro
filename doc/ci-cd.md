# Integración continua

El workflow único [`.github/workflows/ci.yml`](../.github/workflows/ci.yml), llamado **CI/CD Desarrollo Seguro**, corre en pull requests, pushes a `main` y se puede lanzar manualmente. Distribuye en paralelo cinco jobs: quality gates (políticas, migraciones, lint, tipos, tests, build y sandbox), Playwright, integración PostgreSQL, auditoría de dependencias y construcción/escaneo de imágenes. El job de imágenes crea las seis imágenes de producción (API, web, worker, coordinador, executor y broker de egress), ejecuta un smoke de API y escanea vulnerabilidades altas y críticas de sistema operativo y bibliotecas con Trivy. Los informes JSON se conservan como artefacto de Actions durante 14 días.

Para iniciarlo manualmente, abre `Actions > CI/CD Desarrollo Seguro > Run workflow` y selecciona `main`. La casilla **Autorizar el deploy de Desarrollo Seguro a desarrolloseguro.org** está desmarcada por defecto. El job **Deploy Desarrollo Seguro** solo aparece y corre si la marcas y todos los jobs paralelos terminan correctamente. Ejecutar el flujo en un pull request o por push nunca despliega. El deploy usa un runner GitHub-hosted efímero y requiere los secretos `DS_DEPLOY_HOST`, `DS_DEPLOY_SSH_KEY` y `DS_DEPLOY_KNOWN_HOSTS` en el environment `desarrollo-seguro-production`. La clave SSH solo permite ejecutar el gateway restringido de despliegue, que valida el comando, tamaño y rutas del archivo recibido antes de extraerlo en un release dedicado. Después comprueba HTTPS y la salud de la API con reintentos.

Después del deploy, el workflow comprueba que `www.desarrolloseguro.org` redirige a `https://desarrolloseguro.org/` sin exponer puertos internos y lanza un análisis autorizado de `grumphya.com`. El gate exige un informe nuevo del perfil `domain-v1`, observaciones concluyentes y scoring con cookies iniciales evaluadas.

El usuario SSH `dsdeploy` no tiene shell interactiva ni acceso a Docker. Su clave se restringe con `command=` y `restrict` en `authorized_keys`; el único comando permitido usa un gateway root-owned y sudoers limita `sudo` al gateway de recepción. La clave privada, la huella del host y el host solo se guardan en el environment dedicado. No configures secretos de otras aplicaciones en ese environment.

SonarQube Community Build se ejecuta solo en el equipo de desarrollo; GitHub Actions no intenta conectarse a `localhost` ni recibe sus análisis. La política de TDD y el flujo local están descritos en [test-driven-development.md](test-driven-development.md) y [sonarqube-local.md](sonarqube-local.md).

Comprobaciones locales:

```sh
pnpm install --frozen-lockfile
pnpm ci:verify
```

El paso PostgreSQL usa una base efímera del workflow. Los resultados de CI describen el commit probado; solo un job `Deploy Desarrollo Seguro` finalizado con éxito acredita que el gateway publicó ese commit y que respondieron la web y la API.
