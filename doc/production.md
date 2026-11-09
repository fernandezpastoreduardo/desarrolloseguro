# Despliegue aislado

Desarrollo Seguro tiene su propio archivo [`compose.production.yaml`](../compose.production.yaml), servicios, redes internas, volumen PostgreSQL e imágenes. No comparte contenedores, base de datos ni volúmenes con otras aplicaciones.

## Topología

- `development-security-database`: PostgreSQL 17 con pgvector y TLS, en red interna.
- `development-security-migrate`: aprovisiona la base y aplica migraciones antes de iniciar la API.
- `development-security-api`: API HTTPS en redes internas, sin puerto publicado.
- `development-security-web`: Nginx con archivos estáticos y proxy TLS a la API. Solo publica `127.0.0.1:18080` (configurable con `DEVELOPMENT_SECURITY_WEB_HOST_PORT`).

El proxy público, DNS y certificados externos quedan fuera de este repositorio. Configura el proxy para alcanzar el puerto local publicado; no expongas directamente la API ni PostgreSQL.

## Arranque

Provisiona en `.secrets/` los archivos requeridos por la sección `secrets` del Compose: credenciales de administrador, migrador y API, certificados TLS de base y API, y CA interna. Mantén los archivos fuera de Git y con permisos restrictivos. Después:

```sh
docker compose -f compose.production.yaml config --quiet
docker compose -f compose.production.yaml up -d --build --wait
```

La ruta `/desarrollo-seguro/` sirve la página estática; `/app/` sirve la aplicación y `/api/desarrollo-seguro/v1/` se reenvía a la API. La persistencia usa el volumen `development-security-postgres`. `docker compose down` conserva los datos; evita `down -v` salvo que quieras borrar deliberadamente la base.

Para detener los servicios:

```sh
docker compose -f compose.production.yaml down
```

No hay despliegue automático desde CI. Antes de operar un entorno público, prepara y revisa certificados, secretos, proxy, copias de seguridad, monitorización y recuperación.
