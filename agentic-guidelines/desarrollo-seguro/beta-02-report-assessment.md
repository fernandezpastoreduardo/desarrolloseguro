# Beta 0.1 — evaluación Beta en el informe público

Este incremento proyecta los controles ya sanitizados de un informe público
en la política `beta-0.1` y persiste el ciclo de vida de la certificación.

## Comportamiento

- El informe conserva `ethicsAssessment` por compatibilidad con la versión
  anterior.
- Añade una evaluación `betaCertification` calculada exclusivamente con
  `DS-TLS-01`, `DS-TLS-02`, `DS-HDR-01` y `DS-PRIV-05`.
- El estado y la puntuación se calculan en servidor a partir de los estados
  sanitizados; el cliente no puede elegir controles ni evidencias.
- Los controles desconocidos permanecen pendientes y no se presentan como
  superados.

## Privacidad y límites

La proyección reutiliza únicamente estados, identificadores y resúmenes ya
permitidos por el contrato público. No expone valores de cookies, cabeceras
completas, contenido HTML, direcciones IP ni diagnósticos internos.

## Ciclo de vida persistido

Cada dominio tiene como máximo una certificación `beta-0.1` vigente:

- `pending`: todavía no hay evidencia suficiente para emitir el sello.
- `active`: existe un informe elegible con puntuación mínima de 90 y sin fallo TLS crítico.
- `suspended`: una certificación activa ha recibido un informe bloqueante.

Un informe con evidencia desconocida no revoca por sí mismo una certificación activa: queda registrado como revisión pendiente y se conserva el último informe elegible. Un fallo TLS crítico o una puntuación inferior al umbral suspende el sello; un informe elegible posterior lo reactiva.

La transición se realiza en la base de datos al completar el informe. Los
eventos se guardan en `ds_beta_certification_events` y no contienen HTML,
cabeceras completas, cookies crudas ni secretos.

Los sellos solo se emiten y verifican cuando `state = active` y el informe
coincide con `certified_report_id`.
