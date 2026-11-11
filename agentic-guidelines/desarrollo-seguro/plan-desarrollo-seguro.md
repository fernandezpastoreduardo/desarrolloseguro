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

La API de consulta, la proyección pública de informes, la persistencia, la landing y el portal React están implementados. El portal pide autorización antes de admitir `on_demand` y PostgreSQL aplica cuotas compartidas. El worker compone procesador, store con rol `ds_worker`, recuperación de leases, telemetría allowlisted y cliente al supervisor Unix; exige CA de base verificada en producción. Compose incorpora worker y coordinador; solo el coordinador usa Docker socket, sin red, y el worker queda en la red interna con acceso al socket Unix de modo limitado. El broker usa una bridge externa exclusiva; el executor queda en `network none`. Los scripts de egress limitan HTTP/HTTPS al bridge `br-ds-egress` y tienen pruebas de política, pero aún no se han aplicado ni comprobado contra señuelos en el VPS. El scheduler de retención sigue como proceso independiente. La API y el worker tienen pruebas de persistencia/contrato aisladas; falta conseguir un informe real en la web pública.

El modelo de amenazas y el contrato local de controles están documentados en [`scanner-safety.md`](scanner-safety.md) y [`controls-and-evidence.md`](controls-and-evidence.md). Esto completa el entregable de diseño documental; no acredita las barreras de red en el VPS ni autentica observaciones de un executor.

## Entregas siguientes

1. **Solicitud desde buscador y cuotas compartidas: completado localmente.** El formulario pide confirmación de autorización; API y PostgreSQL admiten `on_demand` con límites de cola, concurrencia, frecuencia y almacenamiento. Tras encolar, el portal consulta el estado cada cinco segundos hasta 24 veces y presenta el informe nuevo cuando queda guardado. Playwright prueba búsqueda, solicitud y recepción del informe con API simulada; el recorrido del worker con fixture prueba persistencia sin tráfico externo. El análisis real sigue deshabilitado.
2. **Runtime aislado: código y Compose listos; validación VPS pendiente.** El runner Docker por trabajo crea un volumen efímero y contenedores separados, limita recursos, usa `network none` en el executor, valida respuesta y limpia recursos. `pnpm sandbox:check` pasó localmente; Compose define worker/coordinador y scripts idempotentes para red y firewall dedicado. En el VPS falta aplicar y comprobar el firewall con señuelos para host, RFC1918, loopback, link-local e IPv6 y confirmar que HTTP/HTTPS del broker sale correctamente. Mantener la admisión sin procesar hasta cerrar esa verificación.
3. **Retención: implementada localmente, pendiente de operación.** El scheduler corre una purga inmediata y luego diaria con corte de 90 días. `ds_retention` solo ejecuta la función protegida y la URL/CA tienen secretos separados. Antes de incorporarlo a Compose hay que medir el tamaño máximo de lote/impacto de la purga y probar restauración.
4. **Hito de prueba del producto: pendiente de informe real.** Playwright verifica búsqueda, solicitud autorizada y presentación de informe con API simulada. Para completar el hito se debe desplegar worker/coordinador en el stack ya existente, probar bloqueos y salida desde el bridge de egress, enviar un análisis acotado de `grumphya.com` autorizado por el propietario y ver el informe final en el portal. Ese resultado valida el flujo, no constituye auditoría independiente ni garantía de seguridad del dominio.

Cada entrega debe incluir pruebas que expresen el contrato, revisión de seguridad y cambios coordinados en [features.md](features.md), [controls-and-evidence.md](controls-and-evidence.md) y [test-plan.md](test-plan.md). Si una puerta falla, el resultado permanece no evaluable y no se publica un `pass`.
