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
2. **Runtime aislado: código, Compose y operación base demostrados.** El runner Docker por trabajo crea un volumen efímero y contenedores separados, limita recursos, usa `network none` en el executor, valida respuesta y limpia recursos. `pnpm sandbox:check` pasó localmente; Compose define worker/coordinador y scripts idempotentes para red y firewall dedicado. El deploy verificado confirma salud del coordinador, API, worker y web; la validación efectiva de egress con señuelos del VPS sigue siendo una comprobación de infraestructura independiente.
3. **Retención: implementada y arrancada en Compose.** El scheduler corre una purga inmediata y luego diaria con corte de 90 días, junto con la limpieza de informes públicos `on_demand` inactivos durante 30 días. `ds_retention` solo ejecuta las funciones protegidas y la URL/CA tienen secretos separados. El deploy comprueba su ciclo inicial y su recuperación; medir lotes, impacto y restauración de backups sigue siendo operación de mantenimiento.
4. **Certificación beta y sello: implementados; transición periódica observada.** La migración 023 registra la evaluación y los eventos de transición; un informe elegible activa el sello, un incumplimiento bloqueante lo suspende y una evaluación elegible posterior lo reactiva. La emisión y la verificación solo aceptan el informe certificado vigente. El 20 de noviembre de 2026 una auditoría programada produjo un informe nuevo y mantuvo el puntero certificado coherente; el resultado sigue siendo una lectura acotada, no una auditoría independiente ni una garantía de seguridad.
5. **C · auditoría periódica: aceptada para Beta 0.1.** La migración 026 encola cada hora auditorías vencidas de certificaciones activas, permite dominios `on_demand` certificados, prioriza solicitudes manuales al reclamar trabajos y mantiene el único slot global. La migración 027 permite reintentar una admisión tras un fallo terminal sin relajar la ventana de 24 horas para trabajos completados. Los schedulers operan en Compose con el rol y secretos aislados de retención; los despliegues controlados demostraron ciclo inicial, reinicio y recuperación saludable, la renovación del 20 de noviembre confirmó informe, ficha y sello actualizados, el VPS registró leases expirados terminados tras el límite de reintentos y el 20 de noviembre observó una notificación real `certification_audit_cycle_failed` con recuperación posterior a `running/healthy`. Las métricas de carga y restauración de backups quedan como mantenimiento. La auditoría privada de Grumphya pertenece exclusivamente a D.

6. **D y cierre global.** El orden incremental, sus dependencias, tests TDD, evidencias y exclusiones están en [`../../doc/beta-stage-d-plan.md`](../../doc/beta-stage-d-plan.md). La validación integral y el punto de parada antes del MVP están en [`../../doc/beta-global-closure-plan.md`](../../doc/beta-global-closure-plan.md).

La etapa D queda aceptada para el alcance contractual `beta-d-0.2`: el smoke
autenticado de producción posterior al despliegue `6981d16` verificó las siete
rutas, 14/14 criterios y `internalScore=100`, manteniendo `externalScore=null`
y sin alterar certificación, sello ni datos públicos. Una ampliación de
criterios debe versionar el contrato y repetir la validación; no se puede
convertir esta puntuación interna en la puntuación global del MVP.

Cada entrega debe incluir pruebas que expresen el contrato, revisión de seguridad y cambios coordinados en [features.md](features.md), [controls-and-evidence.md](controls-and-evidence.md) y [test-plan.md](test-plan.md). Si una puerta falla, el resultado permanece no evaluable y no se publica un `pass`.
