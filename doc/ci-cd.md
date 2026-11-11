# Integración continua

El workflow [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) verifica cambios en pull requests y en `main`. Usa Node 26.13 y pnpm 12.5.1, instala con lockfile congelado, ejecuta calidad y pruebas PostgreSQL contra un servicio efímero, construye la imagen de la API y realiza un smoke aislado.

El workflow [`.github/workflows/deploy-development-security.yml`](../.github/workflows/deploy-development-security.yml) permite lanzar un despliegue manual desde `main`. Hay que marcar expresamente la casilla `deploy`; sin ella, el trabajo se omite. El workflow requiere un runner self-hosted con las etiquetas `linux`, `x64` y `desarrollo-seguro-deploy`, y el environment `desarrollo-seguro-production`. Ejecuta el script de despliegue con `sudo`, porque este verifica la política de egress y usa Docker. No usa secretos SSH ni configura el proxy público.

El runner de producción se instala en el VPS como `dsrunner`, vinculado solo a este repositorio y con la etiqueta `desarrollo-seguro-deploy`. No pertenece al grupo `docker`; `sudo` permite únicamente invocar el script de despliegue en la ruta fija del workspace del runner. El job usa el environment `desarrollo-seguro-production`, que no debe compartir secretos con otros proyectos. No registres el runner para otros repositorios ni ejecutes en él workflows de pull requests.

SonarQube Community Build se ejecuta solo en el equipo de desarrollo; GitHub Actions no intenta conectarse a `localhost` ni recibe sus análisis. La política de TDD y el flujo local están descritos en [test-driven-development.md](test-driven-development.md) y [sonarqube-local.md](sonarqube-local.md).

Comprobaciones locales:

```sh
pnpm install --frozen-lockfile
pnpm ci:verify
```

El paso PostgreSQL usa una base efímera del workflow. La auditoría de dependencias también forma parte del job. Los resultados de CI describen el commit probado; no acreditan un despliegue externo.
