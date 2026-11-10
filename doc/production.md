# Despliegue aislado

Desarrollo Seguro tiene su propio archivo [`compose.production.yaml`](../compose.production.yaml), servicios, redes internas, volumen PostgreSQL e imágenes. No comparte contenedores, base de datos ni volúmenes con otras aplicaciones.

## Topología

- `development-security-database`: PostgreSQL 17 con pgvector y TLS, en red interna.
- `development-security-migrate`: aprovisiona la base y aplica migraciones antes de iniciar la API.
- `development-security-api`: API HTTPS en redes internas, sin puerto publicado.
- `development-security-web`: Nginx con archivos estáticos y proxy TLS a la API. No publica puertos del host y se une a la red de entrada dedicada `development-security-ingress`.

El proxy público, DNS y certificados externos quedan fuera de este repositorio. Crea antes la red Docker externa `development-security-ingress` como red bridge interna. Conecta a ella únicamente el proxy público y `development-security-web`; no conectes el proxy a `development-security-edge`, porque esa red también contiene la API. Así, el proxy público solo puede alcanzar la web de Desarrollo Seguro y no la API ni PostgreSQL.

Para el Caddy existente del VPS, añade el contenido de [`docker/Caddyfile.development-security`](../docker/Caddyfile.development-security) como bloques adicionales, sin editar los bloques de otros dominios. Primero valida el Caddyfile completo con `caddy validate`; solo después recárgalo con `caddy reload`. El fragmento reenvía únicamente el dominio de Desarrollo Seguro a la web en la red de entrada y deja TLS público en Caddy. DNS debe apuntar el dominio y `www` al VPS; conserva los registros `MX` y `TXT` de correo.

## Arranque

Provisiona en `.secrets/` los archivos requeridos por la sección `secrets` del Compose: credenciales de administrador, migrador, API, worker y retención, certificados TLS de base y API, y CA interna. `ds_worker` solo recibe funciones de cola y finalización; `ds_retention` solo recibe `ds_purge_expired_reports`, que impide borrar informes con menos de 90 días. Los dos procesos siguen fuera del Compose. El scheduler `pnpm --filter @desarrolloseguro/persistence retention-scheduler` ejecuta el ciclo al arrancar y luego cada 24 horas; necesita `DS_RETENTION_DATABASE_URL_FILE` y, en producción, `DS_RETENTION_DATABASE_TLS_CA_FILE`. Mantén los archivos fuera de Git y con permisos restrictivos. Después:

```sh
docker compose -f compose.production.yaml config --quiet
docker compose -f compose.production.yaml up -d --build --wait
```

La ruta raíz `/` y `/desarrollo-seguro/` sirven la página estática inicial; `/app/` sirve el portal de consulta y `/api/desarrollo-seguro/v1/` se reenvía a la API. La persistencia usa el volumen `development-security-postgres`. `docker compose down` conserva los datos; evita `down -v` salvo que quieras borrar deliberadamente la base.

Para detener los servicios:

```sh
docker compose -f compose.production.yaml down
```

No hay despliegue automático desde CI. Antes de operar un entorno público, prepara y revisa certificados, secretos, proxy, copias de seguridad, monitorización y recuperación.
