# Cierre de la Beta 0.1

Este documento fija el estado de la entrega Beta revisada antes de definir el
MVP. Separa implementación, validación automatizada, validación operativa y
aceptación de etapa. No autoriza despliegues ni sustituye la validación
operativa del VPS.

## Estado por etapa

| Etapa | Implementación | Validación automatizada | Validación operativa | Aceptación |
| --- | --- | --- | --- | --- |
| A · lectura y evaluación pública | Presente en código | Tests, PostgreSQL aislado, CI y smoke contractual | El VPS expone un informe real de `grumphya.com` con 9/9 comprobaciones y 7/8 criterios; la proyección es acotada y no contiene datos sensibles. El informe actual falla CSP y no concede certificación | **Validada operativamente; certificación pendiente por el resultado observado** |
| B · historial y comparabilidad | Presente en código | Tests de historial, UUID, perfiles comparables, retención y Playwright | La API pública devuelve 12 entradas acotadas, ordenadas y del mismo perfil; cada UUID resuelve y el puntero certificado coincide con un informe histórico | **Validada para el alcance Beta** |
| C · auditoría periódica | Presente en Compose y despliegue aislado | Migraciones 026/027, tests del scheduler y PostgreSQL aislado | El scheduler renovó `grumphya.com` en producción con un informe nuevo, ficha actualizada y `certifiedReportId` coincidente; el VPS registra 9 leases expirados terminados tras 3 intentos; el 20-11-2026 observó `certification_audit_cycle_failed` y recuperó `running/healthy` | **Aceptada para Beta 0.1** |
| D · auditoría privada de Grumphya | Contrato, lectores allowlisted, proyección, puntuación separada, informe y runner D-08 presentes | Tests unitarios, PostgreSQL aislado y puertas de tipado/lint/build; no se usan fixtures como evidencia de producción | Smoke autenticado posterior al despliegue `6981d16`: siete rutas firmadas, 14/14 criterios, `internalScore=100`, `externalScore=null`, sin modificar certificación pública | **Aceptada para el alcance `beta-d-0.2`; ampliaciones requieren una nueva versión contractual** |

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

La suite ejecutada el 19 de noviembre de 2026 reúne 822 pruebas superadas de
los paquetes core, web, persistence, API y worker, con las omisiones explícitas
de PostgreSQL/runtime indicadas por cada paquete. Además, el 18 de noviembre
de 2026 se levantó una base PostgreSQL
efímera con la misma imagen de CI y `pnpm test:postgres` pasó 95/95 pruebas de
persistence y 1/1 de worker, incluido el ciclo de certificación y sus políticas
de admisión. El contenedor se eliminó al terminar. Los diagnósticos Docker
esperables de los dobles de worker no se consideran fallos de la suite.

La política de admisión se conserva en migraciones append-only: la caché de 60
minutos y la ventana de 24 horas se reactivan en 025; 026 añade las auditorías
periódicas y 027 permite reintentar después de un fallo terminal sin saltarse la
ventana para trabajos completados.

### Evidencia histórica anterior al cierre global

Las comprobaciones de esta sección son históricas y sirven para explicar la
secuencia de transición. El estado vigente y las condiciones de salida están
en [`beta-global-closure-assessment.md`](beta-global-closure-assessment.md).

La comprobación de solo lectura del VPS del 18 de noviembre de 2026 devuelve
para `grumphya.com` un informe `domain-v3` con puntuación ética externa 69/100
(6 de 8 criterios evaluados) y una evaluación beta de certificación 50/100
(2 de 3 categorías evaluadas). El estado de certificación continúa en
`pending`, con `certifiedReportId: null`, porque TLS no es concluyente y las
cabeceras fallan. Esta evidencia confirma que el informe ya contiene datos
observables; no se usa para elevar el estado ni para fabricar una puntuación
interna de D.

La misma comprobación confirmó que las migraciones 025–027 están aplicadas,
pero las dos certificaciones almacenadas siguen en `pending` y el historial
agregado solo registra dos eventos iniciales `NULL → pending`. No existe aún
una transición operativa a `active` sobre la que el scheduler pueda ejecutar
una renovación.

El despliegue `44568309742` (commit `d113292`) volvió a pasar todas las puertas
de CI y dejó pública la política CSP. El smoke posterior reutilizó de forma
deliberada el informe vigente de `grumphya.com` por la ventana de admisión;
no se presenta ese resultado como una auditoría nueva. Un análisis aislado del
subdominio propio `www.desarrolloseguro.org` confirmó además que una
redirección fuera del hostname solicitado se conserva como `unknown` con
diagnóstico acotado, sin convertirla en un aprobado.

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

La etapa C queda completada porque existe evidencia de una auditoría
certificada vencida que actualizó informe, ficha, sello y estado en el entorno
real, junto con una notificación producida por una incidencia real del
scheduler el 20 de noviembre de 2026 a las 17:32:50 UTC. La recuperación ante
leases expirados también tiene evidencia de producción. El scheduler, su canal
JSONL y su reinicio controlado están demostrados; la red se reconectó y el
contenedor volvió a `running/healthy` sin reiniciar API, worker, base de datos ni
web. En D, el runner local ya
coordina la lectura secuencial y el fallo seguro. La ejecución privada
autorizada del 19 de noviembre de 2026 confirma el canal de producción, la
verificación JWT/atestación y la proyección acotada; su resultado deliberadamente
incompleto se documenta en [la evaluación operativa de D](beta-stage-d-assessment.md)
y no concede un sello ni una certificación.

La repetición one-shot desde el VPS del 19 de noviembre a las 20:53 (hora de
Madrid) volvió a completar las siete lecturas autenticadas (`6/14`, estado
`incomplete`, `internalScore: null`) con el `auditRef`
`sha256:60db0358839fd3f00bd7db273eb61a53d000a252c7b66094d3775aacf89a96a7`.
La ejecución no activó el servicio normal ni modificó el stack persistente.

El cierre global de Beta es posterior a A, B, C y D. Solo entonces se validará
la operación integral, la puntuación externa e interna, la puntuación global
absoluta, los estados de certificación, los sellos, las auditorías periódicas,
las notificaciones y las evidencias de producción. La definición del MVP queda
fuera de este cierre. No se presenta una puntuación absoluta ficticia ni se
modifica el repositorio de Grumphya para suplir evidencias.

### Informe público posterior al despliegue de Grumphya (19 de noviembre de 2026,
21:33 UTC)

Tras el despliegue de Grumphya #288, el análisis solicitado desde Desarrollo
Seguro produjo el informe `7d9ad93f-cd1a-4af2-9176-d9cfb69d1e0b` con el perfil
`domain-v3`. El informe es fresco y verificable: `DS-HDR-01` quedó en `pass`
con `csp: true`, junto con DNS, TLS, HTTP, cookies, rastreadores y rendimiento.
El veredicto es `pass`, la puntuación ética externa es `100/100` (7 de 8
criterios evaluados) y la evaluación Beta es `100/100`, con las tres
categorías concluyentes en `pass`. La certificación quedó `active` y su
`certifiedReportId` coincide con ese informe.

 Esta evidencia cierra la comprobación pública de CSP y deja disponible una
 certificación activa para la siguiente validación de C.

### Renovación programada observada (20 de noviembre de 2026, 05:29 UTC)

La comprobación posterior confirmó que el scheduler sí ejecutó la renovación:
el último informe pasó a ser `2c6fdf6c-18b2-4c31-b230-6d52d9e0687c` con
`trigger: scheduled`, distinto del informe manual anterior
`7d9ad93f-cd1a-4af2-9176-d9cfb69d1e0b`. El veredicto continúa en `pass`,
`DS-HDR-01` mantiene `csp: true`, la evaluación Beta es `100/100` y la
certificación permanece `active` con `certifiedReportId` coincidente.

La puerta ejecutada con el informe anterior como referencia devolvió
`report_refreshed=yes`, `certification_state=active`,
`assessment=eligible` y `certified_report=matches`. La ficha pública enlazada
al informe programado responde `200`. Esta evidencia demuestra la transición
de informe y puntero de certificación producida por C; la validación de
recuperación ante lease ya tiene evidencia específica de producción. La
notificación real de `certification_audit_cycle_failed` queda documentada en
la evaluación de C y cierra el último criterio operativo.

Los informes detallados de esta revisión están en
[`beta-stage-c-assessment.md`](beta-stage-c-assessment.md), el plan de D en
[`beta-stage-d-plan.md`](beta-stage-d-plan.md) y el plan de cierre global en
[`beta-global-closure-plan.md`](beta-global-closure-plan.md).
