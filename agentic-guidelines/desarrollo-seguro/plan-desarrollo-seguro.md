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

La API de solo lectura, la proyección pública de informes, la persistencia, la landing y el portal React están implementados. El worker compone ahora procesador, store PostgreSQL con rol `ds_worker`, recuperación periódica de leases vencidos, telemetría allowlisted y cliente al supervisor Unix; el ciclo de polling es serial, configurable dentro de límites y se detiene con SIGINT/SIGTERM. La recuperación se ejecuta antes del claim, con máximo tres intentos y como mucho cada 15 segundos. La configuración exige URL de base en fichero, identidad esperada del socket y ruta absoluta. El entrypoint está disponible mediante `pnpm --filter @desarrolloseguro/worker start`, pero no se incorpora al despliegue. Las pruebas previas cubren HTTP→HTTPS local, TLS fixture, DNS rebinding sintético y persistencia PostgreSQL aislada. No hay scheduler de retención, admisión pública ni egress habilitado; el runner Docker validado sigue en `network none`.

El modelo de amenazas y el contrato local de controles están documentados en [`scanner-safety.md`](scanner-safety.md) y [`controls-and-evidence.md`](controls-and-evidence.md). Esto completa el entregable de diseño documental; no acredita las barreras de red en el VPS ni autentica observaciones de un executor.

## Entregas siguientes

1. **Primitivas de cola, reintentos y telemetría: completado localmente.** La transición SQL exige lease vigente, permite tres intentos, aplica backoff acotado y expone solo `executor_failed`; PostgreSQL limita a un scan global y el procesador emite telemetría sin datos del trabajo. El entrypoint conecta el adaptador JSON Lines al worker; la API pública sigue siendo de solo lectura y no hay admisión desde el producto.
2. **Runtime aislado: parcialmente completado localmente.** El runner Docker por trabajo crea un volumen efímero y contenedores separados de broker y executor, limita CPU/memoria/procesos, usa `network none`, valida la respuesta y limpia recursos. `pnpm sandbox:check` confirma cinco checks `unknown`; el worker conecta con el supervisor por socket Unix. Quedan por aplicar y demostrar firewall de host, bloqueo de destinos privados/host/gateway/IPv6 y tráfico señuelo con conectividad habilitada. No se habilitan scans.
3. Antes de desplegar worker/supervisor, cerrar política efectiva de egress y pruebas señuelo en Linux, definir scheduler de retención y cuotas, y revisar que el rol `ds_worker` solo ejecute funciones permitidas. Después medir recursos y probar backup/restauración. Una prueba controlada de dominio solo llega tras superar esas puertas y acordar el alcance.

Cada entrega debe incluir pruebas que expresen el contrato, revisión de seguridad y cambios coordinados en [features.md](features.md), [controls-and-evidence.md](controls-and-evidence.md) y [test-plan.md](test-plan.md). Si una puerta falla, el resultado permanece no evaluable y no se publica un `pass`.
