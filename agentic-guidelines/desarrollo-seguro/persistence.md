# Persistencia

El paquete `apps/desarrollo-seguro/persistence/` contiene el aprovisionador, migraciones SQL y `PostgresScanStore`. El Compose del repositorio inicia PostgreSQL propio y ejecuta el aprovisionamiento/migraciones mediante `development-security-migrate` antes de arrancar la API.

Los roles de runtime siguen mínimo privilegio: el rol API lee solo la proyección pública; el worker no tiene lectura directa de resultados y las operaciones de trabajo se exponen mediante funciones controladas. Las migraciones fijan grants, restricciones de integridad y catálogo de perfiles. Las suites PostgreSQL locales comprueban esas reglas.

La API expone lecturas públicas y una solicitud explícita de análisis; esta última crea una admisión `on_demand` y encola dentro de PostgreSQL mediante funciones `SECURITY DEFINER`. `ds_api` no puede insertar directamente en dominios o trabajos; worker, rol público y rol de retención no ejecutan la función de admisión. El límite compartido es 10 trabajos en espera, un trabajo simultáneo y 24 horas por hostname; las altas on-demand tienen un máximo de 1000 filas. Existe un entrypoint worker, que usa `ds_worker` desde un fichero secreto, polling serial, recuperación periódica de leases vencidos y el cliente del supervisor Unix; Compose aún no lo arranca. El worker no recibe permisos de lectura directa de resultados ni acceso Docker. El canal fixture recorre el procesador hasta un informe público en PostgreSQL aislado mediante `pnpm test:postgres`. Esto no implica que se generen informes desde sitios reales. El scheduler `pnpm --filter @desarrolloseguro/persistence retention-scheduler` aplica el purgado diario de informes con más de 90 días mediante el rol `ds_retention`, que solo ejecuta esa función; el scheduler sigue fuera de Compose.

## Pruebas PostgreSQL

`test:postgres` puede crear y borrar bases y roles globales. Ejecútalo solo con `DS_TEST_POSTGRES_ISOLATED=1`, `DS_TEST_DATABASE_URL` apuntando a loopback y un cluster local dedicado. La URL no puede incluir query ni fragmento y la base administrativa debe comenzar por `development_security_test_`. La guardia no demuestra que el cluster esté aislado; el operador debe comprobarlo.

CI crea un servicio temporal pgvector para esta suite. No usa credenciales ni infraestructura externa. Las pruebas locales no validan TLS de producción, egress, firewall, rendimiento ni recuperación de backups.

## Datos y operación

La base, los roles, el volumen y las credenciales de este proyecto son propios. No deben montarse ni reutilizarse recursos de otra aplicación. El volumen Compose se llama `development-security-postgres`. Antes de operar con datos reales, definir y probar copias, restauración, retención y rotación de secretos.
