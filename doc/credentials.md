# Credenciales y secretos

El Compose propio lee sus secretos desde `.secrets/` (o desde `DEVELOPMENT_SECURITY_SECRETS_DIR`). Deben existir los archivos definidos al final de [`compose.production.yaml`](../compose.production.yaml): credenciales de administrador/migrador/API/worker/retención, TLS de PostgreSQL y API, y la CA interna. `development_security_worker_database_url` es el login separado `ds_worker`; `development_security_retention_database_url` es el login `ds_retention`, que solo puede ejecutar el purgado sujeto a la ventana de 90 días.

Usa valores únicos y aleatorios para cada entorno, limita permisos de lectura y conserva la clave privada de la CA fuera del servidor de aplicación. No guardes secretos en Git, logs, imágenes Docker ni documentación. `.gitignore` excluye `.secrets/`. El worker y el scheduler de retención usan sus URL en ficheros separados y exigen una CA verificada en producción. El scheduler ejecuta solo los purgados protegidos de 90 días y de inactividad pública de 30 días, y permanece fuera de Compose hasta que se revise su operación y el backup/restauración.

El repositorio no genera ni almacena estos secretos, no incluye un gestor de secretos y no configura credenciales de otra aplicación. Rota credenciales y certificados según el procedimiento operativo del entorno.
