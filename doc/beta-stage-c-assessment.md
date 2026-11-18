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
- La migración `028` ignora resultados con `completed_at` anterior al último
  estado consolidado y bloquea la fila de certificación durante la decisión.
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

- La suite local documentada reúne 802 pruebas superadas (91 adicionales
  quedan omitidas porque requieren PostgreSQL aislado o recursos de runtime).
- PostgreSQL aislado pasó 95/95 pruebas, incluidas las de ciclo de
  certificación, prioridad, admisión, scheduler y resultados fuera de orden.
- La batería del worker en PostgreSQL aislado pasó 1/1 prueba, y la suite
  completa de paquetes pasó sin fallos fuera del sandbox (los cuatro tests de
  integración HTTP requieren permiso para abrir `127.0.0.1`).
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
| Planificación horaria | Implementada y arrancada en producción | El scheduler certificador completa el ciclo inicial en el deploy `44352363402`; queda observar una auditoría vencida |
| Ejecución manual y prioridad | Cubierto por tests | Falta una ejecución controlada en el entorno real |
| Concurrencia y único slot | Cubierto por PostgreSQL aislado | Falta evidencia operativa bajo el runtime real |
| Recuperación y cancelación segura | Cubierto por tests y reinicio controlado | El mismo deploy reinició ambos schedulers y volvió a observar ciclos completados sin tocar otros servicios |
| Actualización de informe, puntuación, ficha y sello | Implementada en código | Falta observar una transición real producida por C |
| Estados de certificación | Implementados y probados localmente | Falta ciclo operativo `active`/`suspended`/reactivación |
| Notificaciones ante incidencias | Implementado como JSONL allowlisted en logs del scheduler | El deploy expone solo categoría y timestamp; faltan incidencias reales para probar la ruta de error |

## Clasificación

### Bloqueantes para aceptar C

- Demostrar un ciclo horario que actualice informe, evaluación, ficha y sello.
- Demostrar recuperación ante un lease expirado y continuación del ciclo en una
  auditoría certificada real.

### Validaciones operativas pendientes

- Medir duración, lote e impacto de una auditoría certificada en el VPS.
- Verificar que el rol `ds_retention` no puede leer datos privados ni ejecutar
  funciones fuera de su contrato.
- Conservar la evidencia de transición sin secretos ni datos de usuario.

### Comprobación de estado del VPS (18 de noviembre de 2026)

La comprobación de solo lectura confirmó que el Compose aislado mantiene el
API, el worker, el coordinador y los dos schedulers de Desarrollo Seguro
arrancados; los servicios de Grumphya permanecieron separados y no se
reiniciaron. Los schedulers dejaron señales categóricas de
`certification_audit_cycle_completed` y `retention_cycle_completed` durante su
ciclo de arranque y recuperación.

El estado público de `grumphya.com` quedó en `stale`, con `activeJobId: null`,
un informe `domain-v3` real con puntuación externa 69/100 y
`certification.state: pending`/`certifiedReportId: null`. Al no existir una
certificación activa vencida, el scheduler no tiene una auditoría periódica
que pueda actualizar informe, sello y estado. Esta comprobación aporta
evidencia operativa del informe inicial y del arranque/recuperación, pero no cierra la
transición de C; para cerrarla hace falta disponer de un dominio certificado
activo y observar su siguiente auditoría en producción.

La consulta agregada de solo lectura sobre `desarrollo_seguro` confirmó además
que las migraciones `025`, `026` y `027` están aplicadas, existen dos filas de
certificación y ambas están en `pending`. El historial de transiciones solo
contiene dos eventos iniciales `NULL → pending`; no hay ninguna transición a
`active`, `suspended` ni reactivación. Esto explica por qué el scheduler puede
completar su ciclo sin encolar una auditoría periódica.

Se añadió `pnpm certification:preflight` como puerta operativa reproducible.
Ejecutada contra el endpoint público actual devuelve `certification_transition_not_ready`:
el proceso falla por la precondición real y no por un timeout genérico. Cuando
exista una certificación activa, la misma puerta exigirá que el sello apunte al
último informe y que un ciclo programado produzca un `reportId` nuevo. El fallo
incluye únicamente categorías acotadas (`report`, `certification_state`,
`assessment`, `certified_report` y `report_refreshed`); no imprime el contenido
del informe ni valores arbitrarios de la respuesta.

### Mejoras no bloqueantes

- SSE o streaming de progreso.
- Panel operativo y métricas históricas.
- Agrupación avanzada de notificaciones.

### Fases posteriores

- Auditoría privada de producción de Grumphya.
- Integración operativa de la puntuación interna y puntuación global absoluta.
- Certificación definitiva y transición automática al MVP.

## Conclusión

C está implementada, validada automáticamente y desplegada con operación base
demostrada. Su estado correcto sigue siendo **pendiente de evidencia de
transición de certificación en producción**: aún no se ha observado una
auditoría programada que actualice un informe, sello y estado de certificación.
No se amplían retroactivamente los criterios para exigir D.

### Comprobación de estado del VPS (19 de noviembre de 2026)

Una segunda consulta de solo lectura confirmó que los schedulers de retención
y certificación siguen `healthy` y que el certificador continúa emitiendo
`certification_audit_cycle_completed` con `affectedCount: 0`. El estado público
de `grumphya.com` sigue `stale`, la certificación sigue `pending` y no hay un
informe certificado activo que pueda activar una auditoría periódica. Esta
observación confirma continuidad del servicio, pero no añade evidencia de la
transición funcional que falta para aceptar C.
