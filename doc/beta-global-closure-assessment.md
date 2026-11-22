# Evaluación del cierre global de Beta

## Resultado vigente (22 de noviembre de 2026)

El cierre global queda **confirmado para Beta 0.1 (`domain-v3`) y la auditoría
privada `beta-d-0.2`**. Las cuatro etapas A–D están aceptadas en su alcance;
las verificaciones actuales de producción y la evidencia histórica específica
de D sustentan la aceptación. Esta conclusión no declara una certificación
definitiva ni inicia el MVP.

| Etapa | Evidencia actual | Estado |
| --- | --- | --- |
| A · evaluación pública | El informe `ea276f54-2d15-4921-bc8f-75afddc316e4`, finalizado el `2026-11-22T02:53:03.935Z`, usa `domain-v3`, tiene veredicto `pass`, 9/9 controles concluyentes y `DS-HDR-01` con `csp: true`. La evaluación Beta está `eligible` con 100 puntos; la certificación está `active` y su `certifiedReportId` coincide con el informe. | **Aceptada para `domain-v3`** |
| B · historial y comparabilidad | La API pública devuelve 12 informes `domain-v3` en orden descendente. El 22-11-2026 se resolvieron los 12 UUID; hostname, perfil e instante de finalización coincidieron con su resumen. El informe certificado más reciente está en el historial. | **Aceptada para Beta 0.1** |
| C · auditoría periódica | PostgreSQL registra la renovación `scheduled` `c1df7096-de8b-4f36-af01-19edfd033a84` a las `2026-11-22T02:52:39Z`; el informe `requested` posterior actualizó la ficha de certificación, que permanece `active/eligible` con el puntero coincidente. El scheduler de certificación y el de retención están `healthy` en el VPS. | **Aceptada para Beta 0.1** |
| D · auditoría privada | La última ejecución de producción documentada, el 20-11-2026 a las `17:21:04.234Z`, leyó las siete rutas allowlisted, validó `beta-d-0.2`, las firmas y la atestación, y completó 14/14 criterios con `internalScore=100`. `externalScore` permaneció `null` y no se modificó la certificación pública. | **Aceptada para `beta-d-0.2`** |

### Cobertura y límites

La evaluación ética externa del informe actual es 100/100 con 7 de 8 criterios
evaluados; `third-party-data-use` sigue `unknown`. Se presenta como parcial y
no se inventa una puntuación global que combine evaluaciones externas e
internas con coberturas distintas. D queda limitado al contrato firmado
`beta-d-0.2`; el resultado completo de 14/14 no se amplía a señales fuera de
ese contrato.

El informe también contiene la dimensión de Privacidad de Solistos (`privacy-v1`)
de 100/100, con 1 de 5 criterios evaluados y 4 no aplicables. Es una dimensión
separada posterior a Beta y no interviene en la nota ni en la elegibilidad de
Beta 0.1.

El 22-11-2026, el estado de VPS confirmó API, worker, web, base de datos,
coordinador, scheduler de certificación y scheduler de retención activos; los
servicios con healthcheck estaban sanos. El despliegue `44977733185` pasó
calidad, PostgreSQL, navegador/Lighthouse, auditoría de dependencias, escaneo
de imágenes, healthchecks y smoke de análisis público de Grumphya.

### Reconciliación de versiones anteriores

Una versión previa de esta evaluación decía que el cierre estaba pendiente por
una discrepancia CSP: el informe del 20-11-2026 `ed8e8b27-ac46-4ad0-91b2-a3e803eb9ab9`
marcaba `csp=false` aunque la respuesta HTTP directa mostraba una CSP presente.
Ese estado era anterior a la corrección del rubricado. Las condiciones de
salida se verificaron luego con el informe fresco `796d5c1b-356f-47ce-8aba-572afd9d18a1`
del 21-11-2026 y vuelven a confirmarse con el informe actual del 22-11-2026,
incluida `csp=true`, certificación elegible y puntero coincidente. Por tanto,
la frase histórica «el cierre global permanece pendiente» queda supersedida y
no describe el estado vigente.

Los detalles por etapa y los límites históricos están en [Cierre de Beta](beta-closure.md),
[la evaluación operativa de D](beta-stage-d-assessment.md) y
[el plan incremental D](beta-stage-d-plan.md). La especificación inicial del
producto y el estado del MVP se describen por separado en
[Requisitos iniciales del MVP](requisitos-iniciales-mvp.md).

## Relación de Solistos con el MVP

La toma inicial de requisitos del MVP sí menciona privacidad y ética como
ámbitos, una base de conocimiento incremental y puntuaciones con cobertura;
sin embargo, no incluye explícitamente la fase Solistos ni su análisis
automatizado de cookies y almacenamiento, recorridos de consentimiento,
catálogo local de proveedores, límites de navegador o dimensión `privacy-v1`.
Solistos se define como fase posterior al cierre de Beta y previa al MVP, y su
primera versión ya está desplegada. Por tanto, **la incorporación explícita de
Solistos al alcance y plan del MVP queda pendiente de una decisión y una
planificación separadas**; este cierre no la presupone.
