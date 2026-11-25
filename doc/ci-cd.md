# Integración continua

El workflow único [`.github/workflows/ci.yml`](../.github/workflows/ci.yml), llamado **CI/CD Desarrollo Seguro**, corre en pull requests, pushes a `main` y se puede lanzar manualmente. Distribuye en paralelo cinco jobs: quality gates (políticas, migraciones, lint, tipos, tests, build y sandbox), Playwright, integración PostgreSQL, auditoría de dependencias y construcción/escaneo de imágenes. El job de imágenes crea las seis imágenes de producción (API, web, worker, coordinador, executor y broker de egress), construye la candidata PostgreSQL 19 sobre Debian 13, ejecuta un smoke de API con esa base y escanea las seis imágenes de aplicación y la candidata de base de datos. De PostgreSQL se conserva el informe completo; la puerta falla si hay hallazgos altos/críticos con arreglo publicado. El job de integración prueba PostgreSQL 19 y restaura un clúster PG17 sintético a un volumen PG19 independiente. Producción conserva PG17 hasta el corte documentado en [postgresql-major-upgrade.md](postgresql-major-upgrade.md). Los informes JSON se conservan como artefactos de Actions durante 14 días.

El job de Playwright ejecuta también `pnpm test:lighthouse`; el laboratorio compila la app y abre un preview local servido en loopback. Rendimiento, Accesibilidad y Buenas prácticas requieren al menos 96 en escritorio y móvil; SEO se calcula y se informa, pero no bloquea `/app/` mientras conserve `noindex`. El laboratorio rechaza solicitudes a terceros y borra sus informes JSON al terminar.

La auditoría de dependencias usa dos umbrales. Las dependencias de producción bloquean con severidad alta o crítica; las dependencias de desarrollo bloquean con severidad crítica y dejan visibles las alertas altas sin parche upstream. Así una herramienta de test o build vulnerable no se confunde con código que se vaya a ejecutar en el VPS, pero tampoco desaparece del resultado. La política se comprueba antes de ejecutar la auditoría mediante `scripts/test-development-security-dependency-audit-policy.mjs`.

La auditoría D conserva un preflight independiente (`pnpm audit:preflight`) y el perfil Compose `internal-audit` de ejecución manual. El perfil completo no arranca por push ni por deploy normal. En cambio, cuando el auditor aislado de procesadores está habilitado, los informes de Grumphya ejecutan los 14 criterios en cada renovación horaria o solicitud bajo demanda. Si faltan claves/allowlist, expira o falla evidencia, el informe público conserva el análisis externo y presenta el bloque privado como «En revisión». Los gates exigen claves de JWT y atestación, `kid`s activos y redes exactas, y rechazan redes abiertas o ficheros de claves con permisos de grupo/otros.

Para iniciarlo manualmente, abre `Actions > CI/CD Desarrollo Seguro > Run workflow` y selecciona `main`. La casilla **Autorizar el deploy de Desarrollo Seguro a desarrolloseguro.org** está desmarcada por defecto. El job **Deploy Desarrollo Seguro** solo aparece y corre si la marcas y todos los jobs paralelos terminan correctamente. Ejecutar el flujo en un pull request o por push nunca despliega. El deploy usa un runner GitHub-hosted efímero y requiere los secretos `DS_DEPLOY_HOST`, `DS_DEPLOY_SSH_KEY` y `DS_DEPLOY_KNOWN_HOSTS` en el environment `desarrollo-seguro-production`. La clave SSH solo permite ejecutar el gateway restringido de despliegue, que valida el comando, tamaño y rutas del archivo recibido antes de extraerlo en un release dedicado. El coordinador de ejecución se inicia y se espera saludable antes que el worker de análisis, para que el worker no consuma trabajos sin tener disponible su socket. Después comprueba HTTPS y la salud de la API con reintentos.

El script de despliegue fuerza `COMPOSE_PROFILES` vacío y mantiene
`DEVELOPMENT_SECURITY_AUDIT_ENABLED=false`, por lo que el perfil de auditoría
privada completa `internal-audit` no se hereda ni se arranca en un deploy
normal. El lector aislado del inventario de procesadores y la proyección de auditoría
privada se habilitan por `DEVELOPMENT_SECURITY_PROCESSOR_TRANSPARENCY_ENABLED`;
el script inicia explícitamente `development-security-processor-auditor` y
espera a que su healthcheck confirme el socket antes de actualizar el worker.
Esto es necesario porque el `up` del worker usa `--no-deps` y no inicia sus
dependencias. El auditor monta únicamente las dos claves necesarias desde
`/opt/desarrollo-seguro/audit-secrets` y usa la ACL
de egress exacta confirmada `172.30.0.1/32`. El inventario conserva scope
`privacy`; la operación adicional ejecuta las siete rutas D allowlisted con
scopes acotados y devuelve solo los 14 estados públicos, nunca el informe
privado ni su puntuación. La prueba de despliegue requiere
un informe `domain-ethics-v5` con 8/8 criterios éticos evaluados y falla si el
inventario queda `unknown` por un error propio del auditor. Una falta de
divulgación o inventario incompleto de Grumphya es un hallazgo concluyente,
no un fallo de observabilidad.
La sonda manual de egress y su procedimiento están en
[internal-audit-egress-runbook.md](internal-audit-egress-runbook.md); no forman
parte de CI ni consumen minutos de GitHub.

Después del deploy, el workflow comprueba que `www.desarrolloseguro.org` redirige a `https://desarrolloseguro.org/` sin exponer puertos internos y solicita análisis autorizados de `grumphya.com` y `desarrolloseguro.org`. Ambos informes deben usar `domain-v4`, incluir diez comprobaciones, al menos cinco observaciones concluyentes y una matriz TLS 1.0–1.3 completa (cada versión debe aportar aceptación booleana o un código de sonda acotado). También se exige `domain-ethics-v5` con ocho criterios concluyentes y evaluación pública de políticas presente; el inventario backend debe quedar sin errores propios del auditor. El informe propio debe acreditar 100/100 en Ética, Privacidad y Global, con el registro versionado del release como evidencia de procesadores. Si la política Beta devuelve `queued` o `running`, el smoke espera hasta 15 minutos para acomodar la cola global serializada y registra cada 30 segundos el estado del trabajo; si devuelve `cached` o `rate_limited`, valida que el informe público existente satisface los mismos criterios. Un `unknown` de transporte es válido cuando conserva la matriz diagnóstica TLS; no se confunde una versión que no pudo negociar con una ausencia de evidencia. Si el análisis termina con error, el worker conserva solo la fase, categoría operativa y códigos de las pruebas de red fallidas; el smoke los imprime en la línea de error. No se almacenan mensajes, rutas, salida de Docker ni contenido del dominio.


El worker también escribe una línea JSON `scan_job_error` cuando una excepción impide completar el trabajo. Su `code` pertenece a una lista fija (`scan_run_insert_failed`, `scan_profile_controls_incomplete`, `worker_processing_failed`, entre otros) y añade una fase fija (`preflight`, `lease_recovery`, `claim`, `validate_job`, `execute`, `persist_failure`, `validate_result` o `persist_success`). Cuando el executor falla y el trabajo se reintenta o termina, `scan_job_failure` registra `outcome`, `failureCode` y el diagnóstico allowlisted `stage`/`code`. Las fases separan observación del navegador, evaluación de privacidad, hallazgos de cookies, comparación de servicios, acceso inicial a la política y validación de la respuesta. Ninguna línea registra el mensaje de excepción, hostname, identificadores, rutas, SQL ni contenido del dominio. En una incidencia, consulta estas líneas con `docker logs` del servicio worker para distinguir el subsistema; no se debe interpretar `worker_lease_expired` como la causa raíz sin evidencia de la fase correspondiente.

El frontend de Vite y el Sass del sitio público se sirven con nombres de archivo que incorporan un hash de contenido y pueden almacenarse como inmutables. La página HTML de la app y las páginas públicas responden `Cache-Control: no-store`; también se mantiene `/app/site.css` como alias sin caché para páginas antiguas. La integración del sello conserva su URL estable y se sirve sin caché para que el embed de `grumphya.com` reciba cambios sin editar su snippet.

El usuario SSH `dsdeploy` no tiene shell interactiva ni acceso a Docker. Su clave se restringe con `command=` y `restrict` en `authorized_keys`; el único comando permitido usa un gateway root-owned y sudoers limita `sudo` al gateway de recepción. La clave privada, la huella del host y el host solo se guardan en el environment dedicado. No configures secretos de otras aplicaciones en ese environment.

SonarQube Community Build se ejecuta solo en el equipo de desarrollo; GitHub Actions no intenta conectarse a `localhost` ni recibe sus análisis. La política de TDD y el flujo local están descritos en [test-driven-development.md](test-driven-development.md) y [sonarqube-local.md](sonarqube-local.md).

Comprobaciones locales:

```sh
pnpm install --frozen-lockfile
pnpm ci:verify
```

El paso PostgreSQL usa una base efímera del workflow. Los resultados de CI describen el commit probado; solo un job `Deploy Desarrollo Seguro` finalizado con éxito acredita que el gateway publicó ese commit y que respondieron la web y la API.


El perfil `domain-v4` añade la comprobación de transparencia de las políticas
públicas (`DS-PRIV-04`). El worker sigue enlaces públicos HTTPS a documentos de
privacidad, cookies, condiciones e información legal, incluidos los de
proveedores enlazados por esas páginas, con DNS/IP fijados y límites por perfil.
La ausencia de información exigible o la denegación explícita es un fallo de
transparencia; los fallos propios de red o del auditor quedan en revisión. La
evidencia persistida contiene solo contadores, estados y la versión del catálogo
local. Véase [transparencia de políticas públicas](transparencia-politicas-publicas.md).
