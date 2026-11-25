# Despliegue aislado

Desarrollo Seguro tiene su propio archivo [`compose.production.yaml`](../compose.production.yaml), servicios, redes internas, volumen PostgreSQL e imágenes. No comparte contenedores, base de datos ni volúmenes con otras aplicaciones.

## Topología

- `development-security-database`: PostgreSQL con pgvector 0.8.7 y TLS, en red interna. El despliegue que sigue activo usa PG17; el Compose preparado para el corte apunta a PG19 sobre Debian 13 y un volumen versionado independiente.
- `development-security-migrate`: aprovisiona la base y aplica migraciones antes de iniciar la API.
- `development-security-api`: API HTTPS en redes internas, sin puerto publicado.
- `development-security-worker`: consume trabajos y solo tiene acceso a PostgreSQL y al socket Unix del coordinador.
- `development-security-runtime-coordinator`: proceso aislado sin red con acceso al socket Docker; crea únicamente executor/broker por trabajo.
- `development-security-retention-scheduler`: scheduler diario con el rol `ds_retention`, sin puertos ni egress.
- `development-security-certification-scheduler`: revisa cada cinco minutos si hay auditorías de certificación de más de 40 minutos y las encola con el rol `ds_retention`, sin puertos ni egress.
- `development-security-web`: Nginx con archivos estáticos y proxy TLS a la API. No publica puertos del host y se une a la red de entrada dedicada `development-security-ingress`.

El proxy público, DNS y certificados externos quedan fuera de este repositorio. Crea antes la red Docker externa `development-security-ingress` como red bridge interna. Conecta a ella únicamente el proxy público y `development-security-web`; no conectes el proxy a `development-security-edge`, porque esa red también contiene la API. Así, el proxy público solo puede alcanzar la web de Desarrollo Seguro y no la API ni PostgreSQL.

Para el Caddy existente del VPS, añade el contenido de [`docker/Caddyfile.development-security`](../docker/Caddyfile.development-security) como bloques adicionales, sin editar los bloques de otros dominios. Primero valida el Caddyfile completo con `caddy validate`; solo después recárgalo con `caddy reload`. El fragmento reenvía únicamente el dominio de Desarrollo Seguro a la web en la red de entrada y deja TLS público en Caddy. Caddy emite HSTS, `X-Content-Type-Options`, `X-Frame-Options` y `Referrer-Policy` una sola vez. Nginx genera la CSP en el build usando hashes de los scripts publicados y SRI en los elementos `<script src>`; no añadas una segunda CSP al fragmento Caddy. DNS debe apuntar el dominio y `www` al VPS; conserva los registros `MX` y `TXT` de correo.

## Arranque

Provisiona en `.secrets/` los archivos requeridos por la sección `secrets` del Compose: credenciales de administrador, migrador, API, worker y retención, certificados TLS de base y API, y CA interna. `ds_worker` solo recibe funciones de cola y finalización; `ds_retention` solo recibe `ds_purge_expired_reports`, `ds_purge_inactive_public_reports` y `ds_enqueue_due_certification_scans`, que impiden usar cortes menores de 90 y 30 días y encolan únicamente auditorías vencidas de certificaciones activas. La segunda función elimina únicamente informes públicos `on_demand` sin certificación activa y conserva dominios monitorizados e informes certificados. Los procesos `retention-scheduler` y `certification-scheduler` se ejecutan ahora en Compose con el rol dedicado, secretos separados, filesystem de solo lectura, sin puertos y solo en la red interna. Sus fallos se notifican como líneas JSON allowlisted en los logs del contenedor (`event=ds_scheduler_notification`), sin hostname, SQL ni detalles de excepción; los ciclos correctos añaden solo un `affectedCount` entero acotado. El worker ejecuta cada trabajo mediante un executor sin red y un broker restringido a su perfil de transporte. Mantén los archivos fuera de Git y con permisos restrictivos.

El presupuesto del coordinador de análisis es de 210 segundos para completar el escaneo base, la observación Solistos (máximo propio de 120 segundos), la preparación y la limpieza del runtime; el cliente espera 215 segundos para dejar margen al cierre ordenado. Estos márgenes no amplían los límites de solicitudes, datos recibidos, proveedores, contextos ni recursos del navegador. Si se agota el plazo total o la respuesta excede el máximo del protocolo, el informe conserva una categoría diagnóstica acotada (`runtime_execution_timeout` o `executor_response_too_large`) sin registrar payloads ni errores crudos. Las excepciones inesperadas usan `executor_application_failed` y una respuesta que no cumple el esquema usa `executor_response_invalid`.

El broker transmite al executor la evidencia agregada por un socket Unix. El contrato permite documentos oficiales y declaraciones públicas estructuradas; el límite de respuesta IPC es 512 KiB de JSON UTF-8 y se comprueba con una prueba de integración que pasa por el socket. Una carga que exceda el máximo devuelve `response_size_limit_exceeded` con una respuesta pequeña y allowlisted, sin cerrar la conexión de forma opaca.

Las migraciones `054_runtime_failure_phases` y `055_runtime_boundary_diagnostics` sincronizan la lista SQL permitida con las fases seguras del runtime para guardar los diagnósticos en el estado público.

Si una capa inferior falla sin aportar un diagnóstico seguro y válido, el worker identifica la frontera conocida: creación de sesión runtime, ejecución del executor o limpieza. El estado público conserva una causa operativa acotada sin revelar texto crudo ni detalles internos.

El estado público y los logs del worker distinguen fallos de observación de
navegador, evaluación de privacidad, hallazgos de cookies, comparación de
servicios, acceso inicial a la política, validación de la respuesta y fronteras
del runtime. Cada
reintento o fallo terminal del executor produce una línea JSON `scan_job_failure`
con `outcome`, `failureCode` y el par `failureDiagnostic.stage`/`code`; consulta
`docker logs` del worker para ver esos datos. Las líneas excluyen mensajes de
excepción, hostnames, identificadores de trabajos y evidencias del sitio.

Antes de desplegar el análisis, prepara la interfaz `br-ds-egress` y comprueba sus filtros exclusivos. Los scripts modifican solo `development-security-egress` y reglas `iptables`/`ip6tables` asociadas a esa interfaz; no configuran UFW ni cambian reglas de otras redes:

```sh
scripts/create-development-security-egress-network.sh create
scripts/configure-development-security-egress-firewall.sh apply
scripts/configure-development-security-egress-firewall.sh verify
scripts/deploy-development-security-analysis.sh
```

Para dominios alojados en este VPS, el firewall permite solo desde `br-ds-egress` las conexiones cuyo destino original sea `DS_HOST_PUBLIC_IPV4` en TCP 80/443. Docker las entrega al proxy web público compartido. Esto hace accesibles las webs públicas servidas por ese proxy desde el analizador; no permite acceso a SSH, correo, bases de datos ni CI. Si cambia la IP pública, define `DS_HOST_PUBLIC_IPV4` al aplicar y verificar el firewall.

`deploy-development-security-analysis.sh` verifica primero la red y el firewall, construye las imágenes API, web, worker, coordinador, executor y broker, ejecuta solo el migrador de Desarrollo Seguro y actualiza únicamente los servicios API, web, worker, schedulers y coordinador del proyecto Compose `desarrollo-seguro`. La base de datos se conserva y no se reinicia; tampoco se reconstruyen ni reinician el proxy o servicios de otras aplicaciones. El workflow manual de GitHub Actions está documentado en [ci-cd.md](ci-cd.md); requiere un runner dedicado y aislado. No conecta el worker ni los schedulers a la red de egress ni monta el socket Docker en ellos. El coordinador es el único servicio que monta `/var/run/docker.sock`; su imagen lleva `docker-cli` compatible con Alpine y no depende de la libc del host. Su socket Unix de control se comparte con el worker mediante un volumen dedicado. Tras arrancar, el script muestra como máximo 20 líneas de los dos schedulers; esas líneas solo contienen categorías allowlisted y timestamps del primer ciclo. Después reinicia únicamente esos dos procesos, vuelve a esperar su estado saludable y muestra una segunda tanda acotada para comprobar recuperación sin reiniciar la base ni los servicios públicos. Al instalar esta política por primera vez, valida primero el bloqueo de loopback, redes privadas, el host e IPv6 contra señuelos; verifica HTTP/HTTPS solo desde la red de egress.

Para actualizar el resto de servicios o iniciar una instalación nueva, conserva además el flujo habitual:

```sh
docker compose -f compose.production.yaml config --quiet
docker compose -f compose.production.yaml up -d --build --wait
```

La ruta raíz `/` y `/desarrollo-seguro/` sirven la página estática inicial; `/app/` sirve el portal de consulta y `/api/desarrollo-seguro/v1/` se reenvía a la API. La persistencia usa el volumen `development-security-postgres`. `docker compose down` conserva los datos; evita `down -v` salvo que quieras borrar deliberadamente la base.

La migración major de PostgreSQL se prepara en [la guía PostgreSQL 17→19](postgresql-major-upgrade.md). CI ejecuta integración en PG19 Trixie y una restauración lógica sintética. El Compose ya reserva `DEVELOPMENT_SECURITY_POSTGRES_VOLUME=development-security-postgres-pg19`, `DEVELOPMENT_SECURITY_POSTGRES_DATA_MOUNT=/var/lib/postgresql` y `DEVELOPMENT_SECURITY_POSTGRES_DATA_DIRECTORY=/var/lib/postgresql/19/docker`. La configuración activa del VPS continúa en PG17 hasta restaurar y verificar el clúster en ese volumen nuevo; no conectes PostgreSQL 19 al volumen PG17.

Para detener los servicios:

```sh
docker compose -f compose.production.yaml down
```

No hay despliegue automático desde CI. Antes de operar un entorno público, prepara y revisa certificados, secretos, proxy, copias de seguridad, monitorización y recuperación.
