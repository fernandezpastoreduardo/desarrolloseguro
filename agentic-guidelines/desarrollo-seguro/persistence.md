# Persistencia

El paquete `apps/desarrollo-seguro/persistence/` contiene el aprovisionador, migraciones SQL y `PostgresScanStore`. El Compose del repositorio inicia PostgreSQL propio y ejecuta el aprovisionamiento/migraciones mediante `development-security-migrate` antes de arrancar la API.

Los roles de runtime siguen mínimo privilegio: el rol API lee solo la proyección pública; el worker no tiene lectura directa de resultados y las operaciones de trabajo se exponen mediante funciones controladas. Las migraciones fijan grants, restricciones de integridad y catálogo de perfiles. Las suites PostgreSQL locales comprueban esas reglas.

La API expone lecturas públicas y una solicitud explícita de análisis; esta última crea una admisión `on_demand` y encola dentro de PostgreSQL mediante funciones `SECURITY DEFINER`. `ds_api` no puede insertar directamente en dominios o trabajos; worker, rol público y rol de retención no ejecutan la función de admisión. La cola compartida limita a 10 trabajos en espera y un trabajo simultáneo; los trabajos `requested` tienen prioridad sobre auditorías `scheduled`. Durante las pruebas, las migraciones `012` y `013` desactivaron temporalmente el intervalo de 24 horas y la reutilización de informes recientes; la migración `025` reactiva la caché de 60 minutos y la ventana de 24 horas para la Beta. La migración `026` permite encolar auditorías horarias de certificaciones activas vencidas y la `027` permite reintentar una admisión tras un fallo terminal sin convertirla en rate limit. Se mantienen los límites antiabuso por minuto y de capacidad. Las altas `on_demand` tienen un máximo de 1000 filas. Compose arranca el worker con rol `ds_worker`, secreto de base de datos por fichero, polling serial, recuperación periódica de leases vencidos y cliente del supervisor Unix. El worker no recibe permisos de lectura directa de resultados ni acceso Docker. El coordinador aislado, único servicio con acceso al socket Docker, lanza executor y broker por trabajo. El canal fixture recorre el procesador hasta un informe público en PostgreSQL aislado mediante `pnpm test:postgres`; la generación de informes reales se valida por el smoke posterior al deploy. Los schedulers `retention-scheduler` y `certification-scheduler` usan el rol `ds_retention`, sus secretos en fichero y permanecen fuera de Compose hasta validar operación y backup/restauración.

## Pruebas PostgreSQL

`test:postgres` puede crear y borrar bases y roles globales. Ejecútalo solo con `DS_TEST_POSTGRES_ISOLATED=1`, `DS_TEST_DATABASE_URL` apuntando a loopback y un cluster local dedicado. La URL no puede incluir query ni fragmento y la base administrativa debe comenzar por `development_security_test_`. La guardia no demuestra que el cluster esté aislado; el operador debe comprobarlo.

CI crea un servicio temporal pgvector para esta suite. No usa credenciales ni infraestructura externa. Las pruebas locales no validan TLS de producción, egress, firewall, rendimiento ni recuperación de backups.

## Datos y operación

La base, los roles, el volumen y las credenciales de este proyecto son propios. No deben montarse ni reutilizarse recursos de otra aplicación. El volumen Compose se llama `development-security-postgres`. Antes de operar con datos reales, definir y probar copias, restauración, retención y rotación de secretos.
