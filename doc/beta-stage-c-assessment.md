# Evaluación de la etapa C de la Beta

## Alcance

La etapa C cubre la automatización periódica de auditorías de dominios
certificados: planificación, ejecución manual, prioridades, concurrencia,
recursos, cancelación segura, actualización de informes, puntuaciones, fichas,
sellos, estados de certificación y notificaciones. No incluye la auditoría
privada de Grumphya ni la puntuación interna; ambas pertenecen a D.

La evaluación separa cuatro niveles que no son equivalentes:

1. **Implementación:** existe código para la capacidad.
2. **Validación automatizada:** tests y puertas de CI cubren el contrato.
3. **Validación operativa:** la capacidad funciona en el entorno real donde se
   ejecutará.
4. **Aceptación:** los criterios funcionales de C están demostrados con la
   evidencia adecuada.

## Evidencias disponibles

### Implementación

- La migración `026_certification_audit_scheduler.sql` encola auditorías
  vencidas cada hora.
- La migración `027` permite reintentar fallos terminales sin convertirlos en
  una admisión completada que bloquee el dominio.
- `certification-scheduler` usa el rol `ds_retention`, un secreto separado y
  una conexión TLS validada en producción.
- La cola da prioridad a trabajos `requested` sobre `scheduled` y mantiene un
  único slot global.
- Worker, leases, transiciones de certificación y proyección del sello están
  implementados en código.
- Los schedulers de retención y certificación están definidos en Compose con el
  rol `ds_retention`, sin egress ni puertos, y se arrancan desde el script de
  despliegue del proyecto.
- Los fallos de ambos procesos tienen un canal local autorizado: JSONL
  allowlisted en los logs del contenedor, limitado a categoría y timestamp.
- El despliegue controlado reinicia ambos schedulers y vuelve a esperar su
  estado saludable; el segundo bloque de logs demuestra que cada uno completa
  de nuevo su ciclo inicial sin reiniciar la base, la API, el worker o la web.

### Validación automatizada

- La suite local documentada reúne 713 pruebas.
- PostgreSQL aislado pasó 94/94 pruebas, incluidas las de ciclo de
  certificación, prioridad, admisión y scheduler.
- El CI del commit `1ef0814` pasó Playwright, auditoría de dependencias,
  quality gates, PostgreSQL e imágenes/Trivy en el run
  `44343419747`.
- Estas pruebas verifican contratos y aislamiento; no prueban que un proceso
  scheduler esté arrancado en el VPS.

### Validación operativa

- El run manual `44341753560` demostró que el despliegue y las comprobaciones
  básicas de salud podían completarse, pero el smoke final falló con
  `public_scan_admission_invalid` antes de producir un informe válido de
  `grumphya.com`.
- El fix posterior del smoke está en `1ef0814`, pero su CI fue un push y el
  job de deploy quedó omitido. No existe, por tanto, evidencia operativa de
  ese commit en el VPS.
- No existe evidencia de una ejecución horaria real, de recuperación del
  scheduler ni de actualización de sello tras una auditoría programada en el
  VPS. El canal de notificación ya está implementado y cubierto localmente,
  pero queda pendiente observarlo en operación.

## Criterios de aceptación

| Criterio | Estado | Evidencia o carencia |
| --- | --- | --- |
| Planificación horaria | Implementado localmente; no demostrado en producción | Falta un scheduler operativo en VPS |
| Ejecución manual y prioridad | Cubierto por tests | Falta una ejecución controlada en el entorno real |
| Concurrencia y único slot | Cubierto por PostgreSQL aislado | Falta evidencia operativa bajo el runtime real |
| Recuperación y cancelación segura | Cubierto parcialmente por tests de worker/runtime | Falta prueba operativa de caída y recuperación |
| Actualización de informe, puntuación, ficha y sello | Implementada en código | Falta observar una transición real producida por C |
| Estados de certificación | Implementados y probados localmente | Falta ciclo operativo `active`/`suspended`/reactivación |
| Notificaciones ante incidencias | Implementado como JSONL allowlisted en logs del scheduler; falta observarlo en VPS | Bloqueante para aceptar C hasta validación operativa |

## Clasificación

### Bloqueantes para aceptar C

- Arrancar y observar el scheduler en el entorno de producción.
- Demostrar un ciclo horario que actualice informe, evaluación, ficha y sello.
- Demostrar recuperación ante fallo, lease expirado y continuación del ciclo.
- Definir y probar un canal de notificación autorizado.

### Validaciones operativas pendientes

- Medir duración, lote, impacto y recuperación en el VPS.
- Verificar que el rol `ds_retention` no puede leer datos privados ni ejecutar
  funciones fuera de su contrato.
- Obtener logs categóricos y evidencia de la ejecución sin secretos ni datos de
  usuario.

### Mejoras no bloqueantes

- SSE o streaming de progreso.
- Panel operativo y métricas históricas.
- Agrupación avanzada de notificaciones.

### Fases posteriores

- Auditoría privada de producción de Grumphya.
- Puntuación interna y puntuación global absoluta.
- Certificación definitiva y transición automática al MVP.

## Conclusión

C está implementada y validada automáticamente en local/CI, pero **no está
aceptada**. Su estado correcto es **pendiente de validación operativa**, sin
ampliar retroactivamente sus criterios para exigir D.
