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
| Persistencia | Migraciones, constraints, leases, concurrencia entre dominios bajo un límite global, reintentos con backoff, códigos de error allowlist, proyección pública y mínimos privilegios. |
| Docker | Servicios, redes internas, loopback-only para web, secretos y volumen exclusivos del proyecto. |
| TLS | Validación de nombres/CA y configuración de proxy con material sintético. |
| UI | Flujos accesibles, estados de carga/error, navegación y adaptación móvil. |
| Primitivas, observador y executor local | Validación DNS/IP, lookup fijado al hostname exacto del trabajo, pinning TLS, límite de respuesta, HTTP→HTTPS de mismo host/puerto/ruta con servidores sintéticos loopback, señales derivadas, métricas de intentos/bytes recibidos y clasificación segura de errores TLS. Un DNS que cambia de IP pública a loopback se rechaza antes de la segunda conexión; no valida firewall ni egress del host. |
| Ensamblador fixture-only | Cobertura exacta de `transport-v1`, errores categóricos sin filtrar detalles y derivación del veredicto; no valida adaptadores de red ni produce tráfico. |
| Canal de proceso y PostgreSQL | El hijo recibe solo hostname/perfil en un protocolo acotado, con entorno vacío y sin lease; el coordinador valida y persiste el resultado. La suite `pnpm test:postgres` recorre el canal con fixture hasta el informe público en una base opt-in aislada. El canal no prueba sandbox del sistema operativo. |
| Fallos y reintentos | El executor no filtra su excepción; la DB solo libera el trabajo con un lease vigente, aplica un máximo de intentos y backoff, y publica únicamente códigos categóricos permitidos. |
| Sandbox Linux del executor | CI ejecuta `pnpm sandbox:check`: construye imagen separada y confirma usuario, capacidades, no-new-privileges, filesystem read-only, tmpfs, ausencia de Docker socket/secretos/interfaces/rutas por defecto de red y topes efectivos de cgroup v2; corre sin red y sin montajes del host. También valida el entrypoint real con input rechazado antes de la red. No demuestra política de egress ni aislamiento del VPS. |
| Política de destino para egress | Pruebas unitarias permiten solo el hostname exacto del trabajo en puertos 80/443 y devuelven IP públicas A/AAAA validadas para conexión fijada. Se rechazan hostname ajeno, puertos alternativos, respuestas mixtas y rebinding. No abre sockets ni demuestra aislamiento de red. |
| Aplicación de autorización al lookup de socket | `createEgressAuthorizedLookup` invoca la autorización con el puerto fijo del transporte, filtra por familia solicitada y entrega las IP públicas validadas sin una nueva resolución. El transporte HTTP usa 80 y HTTPS 443; las pruebas usan resolvers sintéticos. Esta política de aplicación no reemplaza firewall ni valida tráfico al gateway/host. |
| Broker IPC de sondas por perfil | Pruebas unitarias y de socket Unix temporal permiten únicamente DNS, TLS, HEAD, GET y cabeceras del hostname del trabajo, cada operación una vez, con máximo dos operaciones en paralelo y cuotas agregadas de solicitudes/bytes. Comprueban tamaño del protocolo, correlación, directorio privado del socket, permisos `0660` y rechazo de hostname ajeno. Hay targets Docker separados y el entrypoint valida el scope del trabajo antes de escuchar. La prueba Docker conecta broker y executor en contenedores sin red mediante un volumen de modo `0700`; el executor usa el volumen como solo lectura y falla cerrado sin socket. Falta el coordinador de ciclo de vida por trabajo y no se demuestra firewall ni egress efectivo. |
| Telemetría del procesador | Las pruebas verifican una categoría fija de resultado y duración no negativa; el evento no acepta hostname, ID de trabajo, lease, perfil ni texto de error. Un fallo del sink no cambia el resultado del trabajo. La integración con un backend sigue pendiente. |
| Cliente del supervisor de runtime | Pruebas con socket Unix local verifican protocolo correlacionado, hostname normalizado/perfil, rechazo de propietario/grupo no esperados, directorio de socket modificable, respuesta inválida y hostname no permitido. Solo valida el cliente; aún no hay proceso servidor que cree contenedores por trabajo ni conexión desde el worker desplegable. |
| Executor y runtime futuro | Separación de credenciales, bloqueo real de destinos privados/host/IPv6, DNS rebinding, límites globales y ausencia de tráfico a servicios señuelo en el runtime de despliegue. La prueba `network none` no cubre egress permitido ni firewall del host. |

## Límites

El executor de red compuesto no tiene entrada operativa; el worker desplegable y el scheduler no están habilitados. CI no escanea hosts ni accede a sistemas externos. Las pruebas deben usar fixtures y dominios reservados de prueba. Antes de habilitar scans será necesario completar la cobertura de SSRF, DNS rebinding, redirects, pinning por conexión, sandbox del proceso, egress, límites de recursos y privacidad con pruebas aisladas y validación en el runtime elegido.
