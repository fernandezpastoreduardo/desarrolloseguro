# Beta 0.1 — evaluación Beta en el informe público

Este incremento proyecta los controles ya sanitizados de un informe público
en la política `beta-0.1`. No crea todavía una certificación persistida ni
emite un sello.

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

La evaluación no implica todavía una certificación activa. La persistencia de
estados y la elegibilidad del sello corresponden a incrementos posteriores.
