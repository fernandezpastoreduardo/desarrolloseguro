# Credenciales y secretos

El Compose propio lee sus secretos desde `.secrets/` (o desde `DEVELOPMENT_SECURITY_SECRETS_DIR`). Deben existir los archivos definidos al final de [`compose.production.yaml`](../compose.production.yaml): credenciales de administrador/migrador/API/worker, TLS de PostgreSQL y API, y la CA interna. La URL `development_security_worker_database_url` es el login separado `ds_worker` para el mismo host/base dedicados; el rol no recibe permisos de lectura de informes ni acceso al contenedor Docker.

Usa valores únicos y aleatorios para cada entorno, limita permisos de lectura y conserva la clave privada de la CA fuera del servidor de aplicación. No guardes secretos en Git, logs, imágenes Docker ni documentación. `.gitignore` excluye `.secrets/`. Si se habilita un proceso worker en producción, monta `development_security_worker_database_url` como `DS_WORKER_DATABASE_URL_FILE` y `internal_tls_ca.crt` como `DS_WORKER_DATABASE_TLS_CA_FILE`; `NODE_ENV=production` exige esa CA y activa validación del certificado y del hostname.

El repositorio no genera ni almacena estos secretos, no incluye un gestor de secretos y no configura credenciales de otra aplicación. Rota credenciales y certificados según el procedimiento operativo del entorno.
