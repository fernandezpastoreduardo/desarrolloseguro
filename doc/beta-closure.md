# Cierre de la Beta 0.1

Este documento fija el estado de la entrega Beta revisada antes de definir el
MVP. Separa implementación, validación automatizada, validación operativa y
aceptación de etapa. No autoriza despliegues ni sustituye la validación
operativa del VPS.

## Estado por etapa

| Etapa | Implementación | Validación automatizada | Validación operativa | Aceptación |
| --- | --- | --- | --- | --- |
| A · lectura y evaluación pública | Presente en código | Tests, PostgreSQL aislado, CI y smoke contractual | No hay un informe real válido producido por el runtime actual de VPS; el deploy anterior pasó salud pero falló el smoke | Pendiente de validación operativa |
| B · historial y comparabilidad | Presente en código | Tests de historial, UUID, perfiles comparables, retención y Playwright | No hay evidencia de un recorrido real sobre producción en la versión actual | Pendiente de validación operativa |
| C · auditoría periódica | Presente en Compose y despliegue aislado | Migraciones 026/027, tests del scheduler y PostgreSQL aislado | El deploy `44352363402` demostró ciclo inicial, reinicio controlado, recuperación saludable y señales JSONL; falta una transición real de certificación vencida a informe/sello actualizado | **Pendiente de evidencia de transición en producción** |
| D · auditoría privada de Grumphya | No implementada por diseño | No aplica | No aplica | Posterior a C |

Las etapas son independientes: A no requiere B, C ni D; B no requiere C ni D;
C no requiere D. La puntuación interna pertenece a D. La puntuación global
absoluta y la transición automática a certificación definitiva pertenecen al
cierre global de la Beta, no al cierre de C.

## Puertas ejecutadas

En el árbol `main` se han ejecutado correctamente:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm build`
- `pnpm migrations:check`
- `pnpm test` fuera del sandbox para permitir los tests HTTP locales
- `pnpm ci:verify audit` fuera del sandbox; la política de producción no detectó
  vulnerabilidades altas o críticas. Queda registrada una alerta alta de
  desarrollo sin parche upstream, según la política documentada.

La suite ejecutada reúne 713 pruebas de los paquetes core, web, persistence,
API y worker. Además, el 18 de noviembre de 2026 se levantó una base PostgreSQL
efímera con la misma imagen de CI y `pnpm test:postgres` pasó 94/94 pruebas
(93 de persistence y 1 de worker), incluido el ciclo de certificación y sus
políticas de admisión. El contenedor se eliminó al terminar. Los diagnósticos
Docker esperables de los dobles de worker no se consideran fallos de la suite.

La política de admisión se conserva en migraciones append-only: la caché de 60
minutos y la ventana de 24 horas se reactivan en 025; 026 añade las auditorías
periódicas y 027 permite reintentar después de un fallo terminal sin saltarse la
ventana para trabajos completados.

## Contratos de seguridad y privacidad

- El scanner público solo observa el perfil y las rutas declaradas, sin
  credenciales, formularios, POST, autenticación ni exploración arbitraria.
- El informe expone contadores, booleanos, estados y resúmenes allowlisted; no
  expone HTML, cabeceras completas, valores de cookies, IPs ni errores crudos.
- La caché y las ventanas de admisión se aplican en PostgreSQL, no en el
  navegador.
- Las auditorías certificadas se encolan con el rol aislado `ds_retention` y
  los trabajos manuales tienen prioridad al reclamar el único slot global.
- No se modifica el repositorio, dominio, CI ni correo de Grumphya.

## Criterio para cerrar esta revisión

La etapa C no se declara completada mientras no exista evidencia de una
auditoría certificada vencida que actualice informe, ficha, sello y estado en el
entorno donde opera el servicio, junto con la comprobación de recuperación ante
un lease expirado. El scheduler, su canal JSONL y su reinicio controlado ya
están demostrados en `44352363402`; lo restante es una validación operativa
específica, no una nueva funcionalidad.

El cierre global de Beta es posterior a A, B, C y D. Solo entonces se validará
la operación integral, la puntuación externa e interna, la puntuación global
absoluta, los estados de certificación, los sellos, las auditorías periódicas,
las notificaciones y las evidencias de producción. La definición del MVP queda
fuera de este cierre. No se presenta una puntuación absoluta ficticia ni se
modifica el repositorio de Grumphya para suplir evidencias.

Los informes detallados de esta revisión están en
[`beta-stage-c-assessment.md`](beta-stage-c-assessment.md), el plan de D en
[`beta-stage-d-plan.md`](beta-stage-d-plan.md) y el plan de cierre global en
[`beta-global-closure-plan.md`](beta-global-closure-plan.md).
