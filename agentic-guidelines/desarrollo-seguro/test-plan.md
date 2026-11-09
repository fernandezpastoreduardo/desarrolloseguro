# Plan de pruebas

## Estado y ejecución

La suite cubre reglas del core, persistencia, API de estado/informe, políticas de ingesta, Compose y configuración TLS. CI ejecuta lint, typecheck, tests, build, integración PostgreSQL efímera, políticas estáticas y un smoke aislado de la imagen.

La suite PostgreSQL puede crear/borrar bases y roles globales. En local requiere `DS_TEST_POSTGRES_ISOLATED=1`, URL de loopback sin query/fragmento y base administrativa con prefijo `development_security_test_`. Ejecutarla solo contra un cluster local dedicado. CI usa un servicio PostgreSQL/pgvector efímero.

Las pruebas de políticas TLS generan certificados sintéticos temporales. No demuestran configuración de certificados reales, conectividad de producción, reglas del host, egress, carga ni restauración de backups.

## Cobertura a mantener

| Área | Comprobaciones |
| --- | --- |
| Core | Validación de hostname, perfil/scope, normalización y reglas de veredicto. |
| API | Validación de entrada, respuestas de estado/informe, rate limiting y errores públicos. |
| Persistencia | Migraciones, constraints, leases, concurrencia, proyección pública y mínimos privilegios. |
| Docker | Servicios, redes internas, loopback-only para web, secretos y volumen exclusivos del proyecto. |
| TLS | Validación de nombres/CA y configuración de proxy con material sintético. |
| UI | Flujos accesibles, estados de carga/error, navegación y adaptación móvil. |

## Límites

El executor de red, el worker desplegable y el scheduler no están habilitados. CI no escanea hosts ni accede a sistemas externos. Las pruebas deben usar fixtures y dominios reservados de prueba. Antes de implementar scans será necesario cubrir SSRF, DNS rebinding, redirects, pinning por conexión, egress, límites de recursos y privacidad con pruebas de red aisladas.
