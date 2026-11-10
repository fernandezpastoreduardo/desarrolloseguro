# Plan de pruebas

## Estado y ejecución

La suite cubre reglas del core, persistencia, API de estado/informe, políticas de ingesta, Compose y configuración TLS. CI ejecuta lint, typecheck, tests, build, integración PostgreSQL efímera, políticas estáticas y un smoke aislado de la imagen.

La suite PostgreSQL puede crear/borrar bases y roles globales. En local requiere `DS_TEST_POSTGRES_ISOLATED=1`, URL de loopback sin query/fragmento y base administrativa con prefijo `development_security_test_`. Ejecutarla solo contra un cluster local dedicado. CI usa un servicio PostgreSQL/pgvector efímero.

Las pruebas de políticas TLS generan certificados sintéticos temporales. No demuestran configuración de certificados reales, conectividad de producción, reglas del host, egress, carga ni restauración de backups. El modelo de amenazas y la evidencia exigida para scans están en [scanner-safety.md](scanner-safety.md); las pruebas locales del transporte no sustituyen las pruebas de aislamiento del runtime real.

## Cobertura a mantener

| Área | Comprobaciones |
| --- | --- |
| Core | Validación de hostname, perfil/scope, normalización y reglas de veredicto. |
| API | Validación de entrada, respuestas de estado/informe, rate limiting y errores públicos. |
| Persistencia | Migraciones, constraints, leases, concurrencia, proyección pública y mínimos privilegios. |
| Docker | Servicios, redes internas, loopback-only para web, secretos y volumen exclusivos del proyecto. |
| TLS | Validación de nombres/CA y configuración de proxy con material sintético. |
| UI | Flujos accesibles, estados de carga/error, navegación y adaptación móvil. |
| Primitivas, observador y executor local | Validación DNS/IP, pinning TLS, límite de respuesta, HTTP→HTTPS de mismo host/puerto/ruta con servidores sintéticos loopback, señales derivadas, métricas de intentos/bytes recibidos y clasificación segura de errores TLS. Un DNS que cambia de IP pública a loopback se rechaza antes de la segunda conexión; no valida firewall ni egress del host. |
| Ensamblador fixture-only | Cobertura exacta de `transport-v1`, errores categóricos sin filtrar detalles y derivación del veredicto; no valida adaptadores de red ni produce tráfico. |
| Canal de proceso y PostgreSQL | El hijo recibe solo hostname/perfil en un protocolo acotado, con entorno vacío y sin lease; el coordinador valida y persiste el resultado. La suite `pnpm test:postgres` recorre el canal con fixture hasta el informe público en una base opt-in aislada. El canal no prueba sandbox del sistema operativo. |
| Executor y runtime futuro | Separación de credenciales, bloqueo real de destinos privados/host/IPv6, DNS rebinding, límites globales y ausencia de tráfico a servicios señuelo en el runtime de despliegue. |

## Límites

El executor de red compuesto no tiene entrada operativa; el worker desplegable y el scheduler no están habilitados. CI no escanea hosts ni accede a sistemas externos. Las pruebas deben usar fixtures y dominios reservados de prueba. Antes de habilitar scans será necesario completar la cobertura de SSRF, DNS rebinding, redirects, pinning por conexión, sandbox del proceso, egress, límites de recursos y privacidad con pruebas aisladas y validación en el runtime elegido.
