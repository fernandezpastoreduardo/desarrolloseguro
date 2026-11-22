# Operación

## Topología aislada

`compose.production.yaml` define un stack propio para Desarrollo Seguro:

- `development-security-web` sirve la página estática y la SPA React, y hace proxy TLS verificado a la API.
- `development-security-api` expone su endpoint HTTPS solo en la red privada del stack.
- `development-security-migrate` crea la base `desarrollo_seguro`, roles dedicados y aplica las migraciones.
- `development-security-database` usa PostgreSQL/pgvector con TLS obligatorio y un volumen propio.
- `development-security-worker` consume los trabajos pendientes, con acceso solo a la red interna de base de datos y al socket Unix del coordinador.
- `development-security-runtime-coordinator` no tiene red; es el único servicio autorizado a usar el socket Docker del VPS.
- `development-security-internal-audit` es un proceso one-shot opt-in del perfil `internal-audit`: no monta PostgreSQL, sale solo por `development-security-egress` y conserva `cap_drop: ALL`, añadiendo únicamente las capacidades necesarias para copiar claves root-only y cambiar al usuario `node`.

El portal no publica puertos del host. Un proxy de borde conectado a la red interna dedicada `development-security-ingress` puede llegar solo al servicio web; la API y la base no tienen puertos de host y la API no pertenece a la red de entrada.

Las redes `development-security-backend` y `development-security-edge` y el volumen `development-security-postgres` pertenecen a esta aplicación. `development-security-ingress` es una red externa dedicada que contiene solo el proxy público y el servicio web; la API y la base de datos no pertenecen a ella. `development-security-egress` solo se asigna a brokers efímeros; el worker y los servicios web/API/base no están conectados a ella. El executor usa `network none`. No se montan sockets Docker, carpetas de otra aplicación, ni sus redes, tablas o secretos dentro del worker.

## Secretos y certificados

Compose lee todos los secretos desde `.secrets/` o desde `DEVELOPMENT_SECURITY_SECRETS_DIR`. No guardes estos archivos en Git. Se requieren:

- `development_security_admin_password`
- `development_security_admin_url`
- `development_security_migrator_password`
- `development_security_api_database_url`
- `development_security_worker_database_url`
- `development_security_retention_database_url`
- `development_security_database_tls.crt` y `.key`
- `development_security_api_tls.crt` y `.key`
- `internal_tls_ca.crt`

La CA raíz se mantiene fuera del contenedor y del repositorio. `scripts/generate-development-security-tls.sh <ca-offline-dir> <secrets-dir>` firma certificados de servidor para `development-security-database` y `development-security-api`; no crea una CA ni reemplaza archivos existentes. Protege las claves privadas y limita sus permisos. Los clientes cargan la CA y verifican hostname/TLS 1.2+ mediante la configuración `ssl` de `pg`; las URLs de aplicación no llevan parámetros adicionales. El worker y el scheduler de retención futuros montan `internal_tls_ca.crt` como su fichero CA.

El aprovisionador es una operación de una sola ejecución con `DS_PRODUCTION_BOOTSTRAP_ENABLED=1`. Revisa las URLs, contraseñas, CA y respaldo del volumen antes de levantar el stack. No reutilices una base de otro proyecto ni apuntes el aprovisionador de producción a una base de pruebas.

## Arranque y comprobaciones

```sh
docker compose --file compose.production.yaml config --quiet
docker compose --file compose.production.yaml build
docker compose --file compose.production.yaml up --detach
curl --fail http://127.0.0.1:18080/desarrollo-seguro/
```

El portal sirve `/desarrollo-seguro/` y `/app/`. El proxy web reenvía `/api/desarrollo-seguro/v1/` únicamente a la API DS y valida su certificado con la CA configurada. La API permite cabeceras de proxy solo desde la subred interna dedicada.

Para detener los contenedores sin borrar los datos:

```sh
docker compose --file compose.production.yaml down
```

No añadas `--volumes` a una parada normal. El volumen es el almacenamiento persistente de informes; prueba su backup y restauración en un entorno aislado antes de definir un procedimiento de recuperación.

## Capacidad y escaneo

### Presupuesto del runtime de análisis

El límite de Solistos de 120 segundos cubre la observación del navegador; no
incluye la comprobación domain-v3 previa, la creación/limpieza de los recursos
efímeros ni el transporte de la respuesta. El timeout del coordinador debe
cubrir esos límites acumulados con margen, sin ampliar el presupuesto del
navegador ni los límites CPU/memoria/solicitudes/bytes aprobados.

Si el coordinador agota su plazo total, devuelve un resultado demasiado grande
o no obtiene el resultado esperado, el fallo conserva un diagnóstico
allowlisted con etapa/código específicos. No guarda texto de excepción, salida
de Docker, ruta local ni payload. La prueba de integración debe confirmar que
el worker persiste ese diagnóstico y que la API pública solo expone sus
categorías permitidas.
Una excepción inesperada del coordinador debe conservar el diagnóstico
allowlisted genérico `executor_application_failed`; un resultado que no
cumpla el esquema de respuesta usa `executor_response_invalid`. Así, el estado
público no queda como `executor_failed` opaco cuando no hay una categoría más
específica segura. El catálogo de etapa/códigos de la migración SQL que valida
`ds_fail_scan` debe actualizarse en la misma entrega que el parser TypeScript;
una prueba PostgreSQL debe persistir al menos la nueva categoría de timeout.
En el límite del worker, un fallo del executor sin diagnóstico válido debe
recibir el fallback allowlisted `executor` / `executor_application_failed`
antes de persistir; nunca se guarda el mensaje crudo del error ni se deja un
fallo terminal del executor sin categoría diagnóstica.

El recolector `apps/desarrollo-seguro/worker/scripts/measure-vps-capacity.mjs` solo consulta recursos locales. Sin `--health-url`, no genera solicitudes de red. Su resultado no sustituye una prueba de carga ni autoriza un scan.

La ejecución real permanece deshabilitada. El paquete worker tiene un executor `transport-v1` que deriva los controles desde DNS/IP pinning y transportes HTTP/HTTPS acotados, y un canal hijo que no transmite las credenciales del coordinador. El proceso aún comparte usuario y filesystem y no dispone de una jaula de red o sistema de archivos. Antes de activar scans hacen falta demostrar la política de egress por destino con pruebas IPv4/IPv6 contra servicios señuelo, aplicar límites globales de solicitudes/bytes/tiempo, medir capacidad y revisar el resultado público. Un fallo de esos gates debe dejar la respuesta como no evaluable, nunca como aprobado.

El coordinador arranca como `development-security-runtime-coordinator` en Compose, con `network_mode: none`. Requiere `DS_RUNTIME_COORDINATOR_SOCKET`, UID/GID, `DS_RUNTIME_EXECUTOR_IMAGE` y `DS_RUNTIME_BROKER_IMAGE`; opcionalmente acepta rutas absolutas `DS_RUNTIME_DOCKER_BINARY` y `DS_RUNTIME_DOCKER_SOCKET` (por defecto `/usr/bin/docker` y `/var/run/docker.sock`). La imagen del coordinador instala `docker-cli` compatible con Alpine y el CLI fija el daemon mediante `docker --host unix://…`, sin usar el contexto Docker del usuario. El socket Docker da control equivalente a root: solo este proceso lo monta. No se monta el binario del host, cuya libc puede no ser compatible con Alpine. El worker accede por un socket Unix con UID 0, GID 1000 y modo `0660`; el directorio compartido impide escritura de otros usuarios.

`scripts/create-development-security-egress-network.sh` crea una bridge sin IPv6 y con el nombre fijo `br-ds-egress`. `scripts/configure-development-security-egress-firewall.sh` instala reglas limitadas a esa interfaz: salida TCP 80/443, denegación de destinos reservados/privados, bloqueo de entrada al host y bloqueo de forwarding IPv6. Nunca vacía cadenas generales ni toca UFW. Antes de activar el tráfico real, valida estas reglas con servicios señuelo en las redes internas de Desarrollo Seguro; la prueba debe fallar al acceder a host, loopback, RFC1918, link-local y IPv6, y permitir únicamente el acceso web previsto. El procedimiento operativo está en [production.md](../../doc/production.md).

La auditoría privada añade una comprobación independiente de conectividad desde
la bridge real. Debe distinguir resolución DNS, conexión TCP, negociación TLS,
respuesta HTTP y rechazo de autenticación. La sonda no envía credenciales ni
persiste respuestas. La ACL de Grumphya solo se fija después de observar la IP
que recibe su proxy; el preflight de Desarrollo Seguro solo acepta hosts
exactos (`/32` o `/128`).
