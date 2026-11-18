# Plan de cierre global de la Beta

## Propósito

El cierre global se ejecuta después de aceptar A, B, C y D. No es un criterio
retroactivo para aceptar una etapa anterior y no autoriza empezar el MVP.

## Validación integral

1. Ejecutar una auditoría externa completa con el perfil acordado y verificar
   que el informe, el historial y la ficha pública son coherentes.
2. Ejecutar una auditoría interna completa dentro del alcance de D y confirmar
   que todas las evidencias proceden de producción.
3. Comprobar la puntuación externa y la interna por separado, el desglose por
   categoría y la distinción entre `unknown`, `not_applicable` y resultado
   concluyente.
4. Ejecutar una auditoría manual y una periódica, incluyendo prioridad,
   concurrencia, recuperación, cancelación, actualización del sello y
   notificaciones.
5. Verificar privacidad, seguridad, rendimiento, accesibilidad, integridad,
   consistencia temporal y ausencia de datos sensibles en los informes.
6. Repetir las puertas de calidad: lint, typecheck, tests, cobertura, build,
   seguridad de dependencias, análisis de imágenes y políticas de CI/CD.

## Certificación definitiva

Grumphya solo puede obtener certificación definitiva si se cumplen
simultáneamente estas condiciones:

- todos los controles obligatorios del alcance están implementados y
  evaluados;
- la puntuación global absoluta redondeada es `>= 90/100`;
- no existe ningún incumplimiento crítico;
- las evidencias son suficientes, actuales y corresponden a producción.

La puntuación global absoluta no se calcula mientras falte cobertura externa o
interna suficiente. Si una condición falla, se conserva el estado de
certificación correspondiente y se informa del motivo.

## Entregable final y punto de parada

El cierre debe producir un informe que incluya:

- alcance y versión de política;
- evidencias por control y origen;
- resultados externos e internos separados;
- puntuaciones, pesos, redondeo y criterios desconocidos;
- historial y estados de certificación;
- sellos y fichas públicas verificables;
- auditorías manuales y periódicas;
- notificaciones, privacidad, seguridad y riesgos;
- puertas de calidad ejecutadas y limitaciones restantes.

Tras emitir ese informe, el desarrollo se detiene. No se implementan
funcionalidades del MVP ni se cambian los criterios de certificación hasta
retomar la toma de requisitos con el usuario.
