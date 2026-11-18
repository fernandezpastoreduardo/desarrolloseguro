# Integración continua

El workflow único [`.github/workflows/ci.yml`](../.github/workflows/ci.yml), llamado **CI/CD Desarrollo Seguro**, corre en pull requests, pushes a `main` y se puede lanzar manualmente. Distribuye en paralelo cinco jobs: quality gates (políticas, migraciones, lint, tipos, tests, build y sandbox), Playwright, integración PostgreSQL, auditoría de dependencias y construcción/escaneo de imágenes. El job de imágenes crea las seis imágenes de producción (API, web, worker, coordinador, executor y broker de egress), ejecuta un smoke de API y escanea vulnerabilidades altas y críticas de sistema operativo y bibliotecas con Trivy. Los informes JSON se conservan como artefacto de Actions durante 14 días.

La auditoría de dependencias usa dos umbrales. Las dependencias de producción bloquean con severidad alta o crítica; las dependencias de desarrollo bloquean con severidad crítica y dejan visibles las alertas altas sin parche upstream. Así una herramienta de test o build vulnerable no se confunde con código que se vaya a ejecutar en el VPS, pero tampoco desaparece del resultado. La política se comprueba antes de ejecutar la auditoría mediante `scripts/test-development-security-dependency-audit-policy.mjs`.

Para iniciarlo manualmente, abre `Actions > CI/CD Desarrollo Seguro > Run workflow` y selecciona `main`. La casilla **Autorizar el deploy de Desarrollo Seguro a desarrolloseguro.org** está desmarcada por defecto. El job **Deploy Desarrollo Seguro** solo aparece y corre si la marcas y todos los jobs paralelos terminan correctamente. Ejecutar el flujo en un pull request o por push nunca despliega. El deploy usa un runner GitHub-hosted efímero y requiere los secretos `DS_DEPLOY_HOST`, `DS_DEPLOY_SSH_KEY` y `DS_DEPLOY_KNOWN_HOSTS` en el environment `desarrollo-seguro-production`. La clave SSH solo permite ejecutar el gateway restringido de despliegue, que valida el comando, tamaño y rutas del archivo recibido antes de extraerlo en un release dedicado. El coordinador de ejecución se inicia y se espera saludable antes que el worker de análisis, para que el worker no consuma trabajos sin tener disponible su socket. Después comprueba HTTPS y la salud de la API con reintentos.

Después del deploy, el workflow comprueba que `www.desarrolloseguro.org` redirige a `https://desarrolloseguro.org/` sin exponer puertos internos y lanza un análisis autorizado de `grumphya.com`. El gate exige un informe nuevo del perfil `domain-v3`, nueve comprobaciones, al menos cinco criterios concluyentes, matriz TLS 1.0–1.3, cookies, referencias a rastreadores, respuesta inicial y puntuación calculable. Espera hasta 15 minutos para acomodar la cola global serializada y registra cada 30 segundos el estado del trabajo. Si el análisis termina con error, el worker conserva solo la fase, categoría operativa y códigos de las pruebas de red fallidas; el smoke los imprime en la línea de error. No se almacenan mensajes, rutas, salida de Docker ni contenido del dominio.

El worker también escribe una línea JSON `scan_job_error` cuando una excepción impide completar el trabajo. Su `code` pertenece a una lista fija (`scan_run_insert_failed`, `scan_profile_controls_incomplete`, `worker_processing_failed`, entre otros) y nunca contiene el mensaje de la excepción, hostname, identificadores ni rutas. En una incidencia, estas líneas se consultan con `docker logs` del servicio worker para distinguir un fallo de persistencia de una expiración posterior del lease; no se debe interpretar `worker_lease_expired` como la causa raíz sin esa categoría previa.

El frontend de Vite y el Sass del sitio público se sirven con nombres de archivo que incorporan un hash de contenido y pueden almacenarse como inmutables. La página HTML de la app y las páginas públicas responden `Cache-Control: no-store`; también se mantiene `/app/site.css` como alias sin caché para páginas antiguas. La integración del sello conserva su URL estable y se sirve sin caché para que el embed de `grumphya.com` reciba cambios sin editar su snippet.

El usuario SSH `dsdeploy` no tiene shell interactiva ni acceso a Docker. Su clave se restringe con `command=` y `restrict` en `authorized_keys`; el único comando permitido usa un gateway root-owned y sudoers limita `sudo` al gateway de recepción. La clave privada, la huella del host y el host solo se guardan en el environment dedicado. No configures secretos de otras aplicaciones en ese environment.

SonarQube Community Build se ejecuta solo en el equipo de desarrollo; GitHub Actions no intenta conectarse a `localhost` ni recibe sus análisis. La política de TDD y el flujo local están descritos en [test-driven-development.md](test-driven-development.md) y [sonarqube-local.md](sonarqube-local.md).

Comprobaciones locales:

```sh
pnpm install --frozen-lockfile
pnpm ci:verify
```

El paso PostgreSQL usa una base efímera del workflow. Los resultados de CI describen el commit probado; solo un job `Deploy Desarrollo Seguro` finalizado con éxito acredita que el gateway publicó ese commit y que respondieron la web y la API.
