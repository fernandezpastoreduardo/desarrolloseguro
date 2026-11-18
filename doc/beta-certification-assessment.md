# Evaluación Beta en informes públicos

Los informes públicos incluyen `betaCertification`, una lectura provisional de
los controles externos que ya tienen evidencia observable en el perfil del
dominio. Esta evaluación no es la puntuación interna de D ni la puntuación
global absoluta del cierre de Beta.

En esta primera integración se consideran tres categorías:

- Seguridad TLS: 40 puntos.
- Cabeceras de seguridad: 30 puntos.
- Cookies y privacidad observable: 30 puntos.

La puntuación se normaliza solo con categorías concluyentes. Una categoría
desconocida no suma ni resta, pero mantiene la evaluación en estado pendiente.
Un fallo TLS crítico o una puntuación inferior a 90 bloquean la elegibilidad.

La migración 023 persiste una certificación por dominio y versión de política.
`pending` indica que faltan controles concluyentes; `active` exige todas las
categorías observables, puntuación igual o superior a 90 y TLS sin fallo
crítico; `suspended` se aplica cuando una certificación activa recibe un
incumplimiento bloqueante. Un informe elegible posterior reactiva una
certificación suspendida. La evidencia incompleta durante una certificación
activa conserva provisionalmente el sello y marca la última evaluación como
`pending`.

La evaluación tampoco interpreta consentimiento real, venta de datos,
ejecución dinámica de scripts o rendimiento completo.

La puntuación externa debe seguir siendo comparable entre Grumphya y los
dominios públicos no certificados cuando comparten perfil. Los resultados
internos se calculan por separado durante D; no se mezclan auditorías ni se
rellenan criterios pendientes para alcanzar el umbral. La certificación
definitiva solo se puede conceder en el cierre global cuando exista cobertura
externa e interna suficiente, la puntuación global redondeada sea al menos
90/100 y no haya incumplimientos críticos.
