# Credenciales y secretos

El Compose propio lee sus secretos desde `.secrets/` (o desde `DEVELOPMENT_SECURITY_SECRETS_DIR`). Deben existir los archivos definidos al final de [`compose.production.yaml`](../compose.production.yaml): credenciales de administrador/migrador/API, TLS de PostgreSQL y API, y la CA interna.

Usa valores únicos y aleatorios para cada entorno, limita permisos de lectura y conserva la clave privada de la CA fuera del servidor de aplicación. No guardes secretos en Git, logs, imágenes Docker ni documentación. `.gitignore` excluye `.secrets/`.

El repositorio no genera ni almacena estos secretos, no incluye un gestor de secretos y no configura credenciales de otra aplicación. Rota credenciales y certificados según el procedimiento operativo del entorno.
