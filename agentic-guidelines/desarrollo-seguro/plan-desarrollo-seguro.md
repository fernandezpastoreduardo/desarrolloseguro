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

La API de consulta, la proyección pública de informes, la persistencia, la landing y el portal React están implementados. El portal pide autorización antes de admitir `on_demand` y PostgreSQL aplica cuotas compartidas. El worker compone procesador, store con rol `ds_worker`, recuperación de leases, telemetría allowlisted y cliente al supervisor Unix; exige CA de base verificada en producción. Compose incorpora worker y coordinador; solo el coordinador usa Docker socket, sin red, y el worker queda en la red interna con acceso al socket Unix de modo limitado. El broker usa una bridge externa exclusiva; el executor queda en `network none`. Los scripts de egress limitan HTTP/HTTPS al bridge `br-ds-egress`. La API persiste ahora la certificación beta por dominio y gobierna el sello con estados `pending`, `active` y `suspended`.

El modelo de amenazas y el contrato local de controles están documentados en [`scanner-safety.md`](scanner-safety.md) y [`controls-and-evidence.md`](controls-and-evidence.md). Esto completa el entregable de diseño documental; no acredita las barreras de red en el VPS ni autentica observaciones de un executor.

### Lectura de las etapas Beta

La aceptación de cada etapa se evalúa por separado. A cubre la auditoría
externa de Grumphya; B cubre los análisis públicos comparables de otros
dominios; C cubre la automatización periódica y su operación; D cubre la
auditoría privada de Grumphya. A no requiere B, C ni D; B no requiere C ni D;
C no requiere D. La implementación y los tests locales no equivalen a una
validación operativa en producción. La puntuación interna pertenece a D y la
puntuación global absoluta, el umbral de 90/100 y la transición automática a
certificación definitiva pertenecen al cierre global de Beta.

## Entregas siguientes

0. **Historial público y comparabilidad: primer incremento implementado.** La
   API expone un historial acotado por hostname y la ficha permite abrir cada
   informe UUID sin mezclar perfiles. La respuesta se proyecta con la misma
   allowlist pública y no se cachea. El scheduler ya elimina tras 30 días los
   informes públicos `on_demand` inactivos sin certificación activa mediante
   una función protegida y conserva certificaciones y dominios monitorizados.
   La migración 025 reactiva la reutilización de un informe durante 60 minutos
   y limita una nueva admisión del mismo dominio a una cada 24 horas cuando la
   caché ha caducado. El progreso se expone mediante el estado consultable del
   trabajo. SSE es una mejora opcional y no forma parte de la aceptación de B.

1. **Solicitud desde buscador y cuotas compartidas: completado.** El formulario pide confirmación de autorización; API y PostgreSQL admiten `on_demand` con límites de cola, concurrencia, frecuencia y almacenamiento. Tras encolar, el portal consulta el estado cada cinco segundos hasta 24 veces y presenta el informe nuevo cuando queda guardado. Playwright prueba búsqueda, solicitud y recepción del informe con API simulada; el recorrido del worker con fixture prueba persistencia sin tráfico externo.
2. **Runtime aislado: código y Compose listos; validación VPS pendiente.** El runner Docker por trabajo crea un volumen efímero y contenedores separados, limita recursos, usa `network none` en el executor, valida respuesta y limpia recursos. `pnpm sandbox:check` pasó localmente; Compose define worker/coordinador y scripts idempotentes para red y firewall dedicado. En el VPS falta aplicar y comprobar el firewall con señuelos para host, RFC1918, loopback, link-local e IPv6 y confirmar que HTTP/HTTPS del broker sale correctamente. Mantener la admisión sin procesar hasta cerrar esa verificación.
3. **Retención: implementada localmente, pendiente de operación.** El scheduler corre una purga inmediata y luego diaria con corte de 90 días, junto con la limpieza de informes públicos `on_demand` inactivos durante 30 días. `ds_retention` solo ejecuta las funciones protegidas y la URL/CA tienen secretos separados. Antes de incorporarlo a Compose hay que medir el tamaño máximo de lote/impacto de la purga y probar restauración.
4. **Certificación beta y sello: implementado en código y pendiente de validación operativa.** La migración 023 registra la evaluación y los eventos de transición; un informe elegible activa el sello, un incumplimiento bloqueante lo suspende y una evaluación elegible posterior lo reactiva. La emisión y la verificación solo aceptan el informe certificado vigente. Falta validar este ciclo completo en el VPS cuando se autorice el siguiente deploy; el resultado sigue siendo una lectura acotada, no una auditoría independiente ni una garantía de seguridad.
5. **C · auditoría periódica: implementada localmente, pendiente de aceptación operativa.** La migración 026 encola cada hora auditorías vencidas de certificaciones activas, permite dominios `on_demand` certificados, prioriza solicitudes manuales al reclamar trabajos y mantiene el único slot global. La migración 027 permite reintentar una admisión tras un fallo terminal sin relajar la ventana de 24 horas para trabajos completados. El proceso `certification-scheduler` usa el mismo rol y secretos aislados de retención; la ejecución en VPS, la recuperación ante caída, la actualización de sellos y las notificaciones siguen pendientes de validación. La auditoría privada de Grumphya pertenece exclusivamente a D.

6. **D y cierre global.** El orden incremental, sus dependencias, tests TDD, evidencias y exclusiones están en [`../../doc/beta-stage-d-plan.md`](../../doc/beta-stage-d-plan.md). La validación integral y el punto de parada antes del MVP están en [`../../doc/beta-global-closure-plan.md`](../../doc/beta-global-closure-plan.md).

Cada entrega debe incluir pruebas que expresen el contrato, revisión de seguridad y cambios coordinados en [features.md](features.md), [controls-and-evidence.md](controls-and-evidence.md) y [test-plan.md](test-plan.md). Si una puerta falla, el resultado permanece no evaluable y no se publica un `pass`.
