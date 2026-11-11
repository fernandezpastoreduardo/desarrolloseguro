# Plan de producto y arquitectura

## Propósito

Presentar evidencia reproducible sobre controles observables de páginas públicas y explicar qué cubre cada resultado. El informe no debe sugerir certificación, auditoría completa, cumplimiento legal ni ausencia de vulnerabilidades.

## Arquitectura

- Aplicación TypeScript con módulos separados: `core`, `persistence`, `api`, `web` y `worker`.
- PostgreSQL propio con roles mínimos y migraciones versionadas.
- Contenedores y volumen Docker propios. El portal se publica en loopback; API y base no tienen puertos del host.
- El proxy de borde y el dominio se configuran por el operador fuera del stack.
- No se comparten datos, credenciales, redes o ciclos de despliegue con otros productos.

## Estado

**Pausa de features completada el 10 de noviembre de 2026.** TDD queda establecido como método de trabajo. SonarQube Community Build está autoalojado solo en el equipo local, con cobertura, Quality Gate y telemetría desactivada; no se instala en el VPS, no se integra en la web pública ni requiere acceso a Grumphya. La línea base inicial y el resultado del triage están registrados en [`doc/quality-baseline.md`](../../doc/quality-baseline.md); el último análisis no tiene hallazgos abiertos.

La API de consulta, la proyección pública de informes, la persistencia, la landing y el portal React están implementados. El portal permite solicitar un análisis tras confirmar autorización; el POST inscribe `on_demand` y aplica cuotas transaccionales compartidas de 10 trabajos en espera, una ejecución global, una solicitud por hostname cada 24 horas y hasta 1000 altas on-demand. La función es ejecutable solo por `ds_api`; la API no inserta directamente en tablas. El worker compone procesador, store PostgreSQL con rol `ds_worker`, recuperación periódica de leases vencidos, telemetría allowlisted y cliente al supervisor Unix; el ciclo de polling es serial, configurable dentro de límites y se detiene con SIGINT/SIGTERM. La recuperación se ejecuta antes del claim, con máximo tres intentos y como mucho cada 15 segundos. La configuración exige URL de base en fichero, TLS con CA verificada en producción, identidad esperada del socket y ruta absoluta. El entrypoint está disponible mediante `pnpm --filter @desarrolloseguro/worker start`, pero no se incorpora al despliegue. El scheduler de retención también está implementado como proceso independiente: ejecuta inmediatamente y luego cada 24 horas, solicita la purga de informes con más de 90 días y usa `ds_retention`, que solo puede ejecutar esa función. Su URL y CA son secretos separados; tampoco se incorpora a Compose. Las pruebas cubren HTTP→HTTPS local, TLS fixture, DNS rebinding sintético, persistencia PostgreSQL aislada y contratos de roles. No hay egress habilitado; el runner Docker validado sigue en `network none`.

El modelo de amenazas y el contrato local de controles están documentados en [`scanner-safety.md`](scanner-safety.md) y [`controls-and-evidence.md`](controls-and-evidence.md). Esto completa el entregable de diseño documental; no acredita las barreras de red en el VPS ni autentica observaciones de un executor.

## Entregas siguientes

1. **Solicitud desde buscador y cuotas compartidas: completado localmente.** El formulario pide confirmación de autorización; API y PostgreSQL admiten `on_demand` con límites de cola, concurrencia, frecuencia y almacenamiento. Playwright prueba búsqueda y solicitud con API simulada; el recorrido del worker con fixture prueba persistencia sin tráfico externo. El análisis real sigue deshabilitado.
2. **Runtime aislado: parcialmente completado localmente.** El runner Docker por trabajo crea un volumen efímero y contenedores separados de broker y executor, limita CPU/memoria/procesos, usa `network none`, valida la respuesta y limpia recursos. `pnpm sandbox:check` confirma cinco checks `unknown`; el worker conecta con el supervisor por socket Unix. Quedan por aplicar y demostrar firewall de host, bloqueo de destinos privados/host/gateway/IPv6 y tráfico señuelo con conectividad habilitada. No se habilitan scans.
3. **Retención: implementada localmente, pendiente de operación.** El scheduler corre una purga inmediata y luego diaria con corte de 90 días. `ds_retention` solo ejecuta la función protegida y la URL/CA tienen secretos separados. Antes de incorporarlo a Compose hay que medir el tamaño máximo de lote/impacto de la purga y probar restauración.
4. **Hito de prueba del producto: preparado en local, sin deploy.** Se puede probar la búsqueda y solicitar una admisión que queda en cola; también se puede probar el análisis con fixture en PostgreSQL aislado. Para exponer el flujo con resultado real hace falta una sesión de despliegue posterior a las pruebas de egress con señuelos en Linux, revisión de permisos/aislamiento/privacidad, medición de recursos, backup/restauración y acuerdo del dominio consentido. No desplegar worker ni habilitar tráfico antes de cerrar esas puertas.

Cada entrega debe incluir pruebas que expresen el contrato, revisión de seguridad y cambios coordinados en [features.md](features.md), [controls-and-evidence.md](controls-and-evidence.md) y [test-plan.md](test-plan.md). Si una puerta falla, el resultado permanece no evaluable y no se publica un `pass`.
