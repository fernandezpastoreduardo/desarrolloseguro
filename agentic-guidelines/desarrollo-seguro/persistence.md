# Persistencia

El paquete `apps/desarrollo-seguro/persistence/` contiene el aprovisionador, migraciones SQL y `PostgresScanStore`. El Compose del repositorio inicia PostgreSQL propio y ejecuta el aprovisionamiento/migraciones mediante `development-security-migrate` antes de arrancar la API.

Los roles de runtime siguen mínimo privilegio: el rol API lee solo la proyección pública; el worker no tiene lectura directa de resultados y las operaciones de trabajo se exponen mediante funciones controladas. Las migraciones fijan grants, restricciones de integridad y catálogo de perfiles. Las suites PostgreSQL locales comprueban esas reglas.

El endpoint disponible es de lectura y no admite scans. No hay worker ejecutable, scheduler ni executor compuesto; el paquete worker sí contiene primitivas de DNS/HTTPS y un procesador de leases. El almacenamiento y esas primitivas no implican que se generen informes desde sitios reales. El barrido de expiración está definido en SQL, pero no hay tarea programada.

## Pruebas PostgreSQL

`test:postgres` puede crear y borrar bases y roles globales. Ejecútalo solo con `DS_TEST_POSTGRES_ISOLATED=1`, `DS_TEST_DATABASE_URL` apuntando a loopback y un cluster local dedicado. La URL no puede incluir query ni fragmento y la base administrativa debe comenzar por `development_security_test_`. La guardia no demuestra que el cluster esté aislado; el operador debe comprobarlo.

CI crea un servicio temporal pgvector para esta suite. No usa credenciales ni infraestructura externa. Las pruebas locales no validan TLS de producción, egress, firewall, rendimiento ni recuperación de backups.

## Datos y operación

La base, los roles, el volumen y las credenciales de este proyecto son propios. No deben montarse ni reutilizarse recursos de otra aplicación. El volumen Compose se llama `development-security-postgres`. Antes de operar con datos reales, definir y probar copias, restauración, retención y rotación de secretos.
