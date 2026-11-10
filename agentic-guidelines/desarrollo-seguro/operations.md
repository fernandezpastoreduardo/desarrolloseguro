# Operación

## Topología aislada

`compose.production.yaml` define un stack propio para Desarrollo Seguro:

- `development-security-web` sirve la página estática y la SPA React, y hace proxy TLS verificado a la API.
- `development-security-api` expone su endpoint HTTPS solo en la red privada del stack.
- `development-security-migrate` crea la base `desarrollo_seguro`, roles dedicados y aplica las migraciones.
- `development-security-database` usa PostgreSQL/pgvector con TLS obligatorio y un volumen propio.

El portal no publica puertos del host. Un proxy de borde conectado a la red interna dedicada `development-security-ingress` puede llegar solo al servicio web; la API y la base no tienen puertos de host y la API no pertenece a la red de entrada.

Las redes `development-security-backend` y `development-security-edge` y el volumen `development-security-postgres` pertenecen a esta aplicación. `development-security-ingress` es una red externa dedicada que contiene solo el proxy público y el servicio web; la API y la base de datos no pertenecen a ella. No se montan sockets Docker, carpetas de otra aplicación, ni sus redes, tablas o secretos. El backend no tiene salida externa. En esta fase no se despliega el paquete worker ni se ejecutan scans.

## Secretos y certificados

Compose lee todos los secretos desde `.secrets/` o desde `DEVELOPMENT_SECURITY_SECRETS_DIR`. No guardes estos archivos en Git. Se requieren:

- `development_security_admin_password`
- `development_security_admin_url`
- `development_security_migrator_password`
- `development_security_api_database_url`
- `development_security_database_tls.crt` y `.key`
- `development_security_api_tls.crt` y `.key`
- `internal_tls_ca.crt`

La CA raíz se mantiene fuera del contenedor y del repositorio. `scripts/generate-development-security-tls.sh <ca-offline-dir> <secrets-dir>` firma certificados de servidor para `development-security-database` y `development-security-api`; no crea una CA ni reemplaza archivos existentes. Protege las claves privadas y limita sus permisos. En la URL administrativa y de API usa `sslmode=verify-full` y el nombre DNS del servicio correspondiente.

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

El recolector `apps/desarrollo-seguro/worker/scripts/measure-vps-capacity.mjs` solo consulta recursos locales. Sin `--health-url`, no genera solicitudes de red. Su resultado no sustituye una prueba de carga ni autoriza un scan.

La ejecución real permanece deshabilitada. El paquete worker ya tiene primitivas locales de DNS/IP pinning y transporte HTTPS acotado; antes de activarla hacen falta el executor que derive los controles, separar el proceso de red de las credenciales, demostrar la política de egress por destino con pruebas IPv4/IPv6 contra servicios señuelo, aplicar límites globales de solicitudes/bytes/tiempo, medir capacidad y revisar el resultado público. Un fallo de esos gates debe dejar la respuesta como no evaluable, nunca como aprobado.
