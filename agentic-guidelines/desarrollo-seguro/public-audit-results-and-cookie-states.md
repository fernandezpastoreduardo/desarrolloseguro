# Resultados públicos y estados de cookies

Estado: aprobado para implementación incremental en el goal de auditoría pública.

## Propósito

Hacer que una persona sin conocimientos técnicos entienda qué comprobaciones se ejecutaron, cuáles detectaron incumplimientos, cuáles no pudieron completarse y qué cookies se observaron antes y después de sus decisiones. Las evidencias jurídicas acreditadas y sus hallazgos conservan la filosofía de `legal-evidence-and-sanctions.md` y `legal-cookie-audit.md`.

## Alcance

- Corregir la discrepancia entre los controles públicos, `privacyAssessment`, `legalCookieFindings` y las tarjetas de categorías.
- Presentar los resultados de evaluación como **Superado**, **Incumplimiento detectado**, **Sin resultado** y **No aplica**. Un control `fail` significa que se ejecutó y falló; no significa «no observado».
- Mantener los resultados de cada criterio y el denominador del perfil. Una comprobación desconocida no cuenta como superada, fallida ni completada.
- No presentar una puntuación como representativa de toda una dimensión si solo se evaluó una fracción de sus criterios. En la nueva versión de la política de Privacidad, la nota solo se publica cuando todos los criterios requeridos están evaluados o marcados no aplicables; si quedan desconocidos, la nota es no disponible y se muestra la cobertura. Los informes históricos `privacy-v1` mantienen su interpretación y parser de compatibilidad.
- Conectar la tarjeta **Legalidad** con sus criterios y hallazgos legales publicados. Conectar la tarjeta **Privacidad** con `privacyAssessment` y sus observaciones del navegador. No usar como fuente única un control heredado de cookies iniciales cuando existen datos más completos.
- Completar la exposición pública de las observaciones de consentimiento que el navegador ya captura. Mantener adquisición en contextos limpios e independientes para primera visita, rechazo y aceptación.
- En cada flujo mostrar inventario/cantidad de cookies antes de elegir, después de la acción, y después de recargar cuando la fase esté disponible. Distinguir cookies únicas dentro de una instantánea de observaciones repetidas entre etapas. Indicar explícitamente una fase ausente o incompleta y su causa; no convertirla en una conclusión de cumplimiento.
- Presentar nombres, dominios, proveedor atribuido, categoría y propósito catalogado. Nunca almacenar ni mostrar valores de cookies.
- Permitir que el catálogo clasifique coincidencias en categorías como analítica, publicidad, mapas de calor u otras prácticas documentadas. Una etiqueta como venta/reutilización de datos requiere una regla versionada con fuente que la sostenga y evidencia que corresponda a esa regla. La coincidencia por nombre de proveedor por sí sola no prueba venta ni infracción.
- Exponer en `DS-QUAL-02` el diagnóstico acotado por perfil móvil/escritorio (código permitido y máscara de métricas ausentes), para que una comprobación sin resultado identifique qué dato de auditoría falta sin publicar errores internos ni datos del sitio.
- Las actualizaciones automáticas del catálogo usan fuentes oficiales y reglas versionadas conforme a la política de catálogo acordada. Cambiar una regla jurídica, artículos, autoridad o consecuencia exige una fuente oficial y actualización trazable.

## Reglas de evaluación y presentación

1. Los contadores de cobertura se calculan desde los criterios que pertenecen al perfil de informe. Deben cuadrar exactamente: superados + incumplimientos detectados + sin resultado + no aplica = total.
2. El titular de resumen emplea etiquetas comprensibles: «X superadas · Y incumplimientos detectados · Z sin resultado». Puede conservar «de N comprobaciones» como contexto, pero no denominar `fail` «no observado».
3. La nota de una dimensión no oculta cobertura parcial. Si no se alcanzó la cobertura definida por esa política, la nota es «Sin puntuación» y se muestran criterios evaluados y pendientes. Nunca se eleva a 100 por excluir silenciosamente criterios desconocidos.
4. Un `legalCookieFinding` acreditado aparece en Legalidad aunque un agregado técnico esté desconocido. La presentación no duplica el mismo hecho como varias cookies si solo cambia su repetición temporal; presenta el recuento por estado y vincula las evidencias al hallazgo.
5. Un inventario completo sin cookies se presenta como cero. Un inventario no ejecutado o incompleto se presenta como desconocido/incompleto, nunca como cero.
6. No se atribuye una cookie a analítica, proveedor o finalidad sin regla catalogada de confianza suficiente o evidencia correlacionada definida por la regla.

## Estados de consentimiento y datos

La fuente de observación existente distingue flujos iniciales, de aceptación y de rechazo, además de `beforeChoice`, `afterChoice` y `afterReload`. Se publican con una nueva versión del contrato de Privacidad, manteniendo lectura compatible con `privacy-v1` histórico. El portal deberá exponer esos datos por separado:

- **Antes de elegir:** instantánea de primera visita limpia, común como referencia de los flujos de decisión si sus evidencias son equivalentes; no sumar dos veces la misma visita.
- **Después de rechazar:** instantánea tomada después del clic de rechazo y sus eventos posteriores.
- **Después de rechazar y recargar:** instantánea tras recarga y evidencia observable de persistencia de la elección.
- **Después de aceptar:** instantánea tomada después del clic de aceptación y sus eventos posteriores.
- **Después de aceptar y recargar:** instantánea tras recarga, cuando el flujo la haya capturado.

El encabezado solicitado «tres estados» agrupa los resultados como **Antes de elegir / Después de rechazar / Después de aceptar**; la recarga se muestra como subestado de la acción correspondiente, no se omite ni se mezcla. Cada etapa informa la cantidad total de cookies, cobertura del inventario y coincidencias del catálogo. Se listan hasta tres ejemplos coincidentes por etapa para mantener el informe acotado. Si la instrumentación actual solo posee tres snapshots para una rama, el contrato se amplía sin reinterpretar los registros históricos.

La evidencia de aceptación nunca se usa como sustituto del flujo de rechazo ni viceversa. Cada flujo parte de almacenamiento limpio. Se mantienen los límites de solicitudes, bytes, tiempo e inventario de `legal-cookie-audit.md`; alcanzar un límite marca la fase como incompleta.

## Corrección de auditoría pública

Investigar y corregir la cadena navegador → observación → resumen de controles → persistencia → API → categoría del portal. En particular, un informe puede tener evidencia en `legalCookieFindings` o en `privacyAssessment.evidence` aunque `DS-PRIV-05` quede `unknown`; esa evidencia no debe desaparecer de la categoría ni originar un recuento falso de cero. El informe público conserva por separado estado técnico, estado jurídico y cobertura.

Los fallos reproducibles del auditor o de persistencia se muestran como errores de comprobación con su etapa y diagnóstico seguro; no como una conclusión sobre la web auditada. Un resultado desconocido solo permanece cuando la adquisición de evidencia realmente no pudo completarse.

## Criterios de aceptación

1. El resumen de los ocho criterios de dominio presenta estados inequívocos y sus cuatro recuentos suman ocho; un `fail` se lee como incumplimiento detectado.
2. La tarjeta Legalidad no oculta hallazgos jurídicos acreditados por un `unknown` heredado; la tarjeta Privacidad muestra la cobertura de su evaluación propia.
3. Un criterio desconocido no se excluye para inflar una nota de dimensión; la cobertura y la regla de nota son visibles y consistentes.
4. Un informe con cookies `_ga` y `_ga_4ZW5GCS16C` de `talentoypersonas.com` presenta dos cookies antes de elegir, después del rechazo y después de recargar, junto a sus hallazgos LSSI acreditados. El flujo de aceptación muestra sus propias cantidades y no se infiere su resultado a partir del rechazo.
5. El mismo informe muestra por etapa coincidencias de catálogo con proveedor/finalidad y no afirma venta de datos si no existe regla/evidencia catalogada que lo demuestre.
6. `grumphya.com` conserva la evaluación limpia de su cookie técnica `grumphya_anon` en el contexto/fase previamente documentados; no se convierte en cookie no esencial por el nuevo formato ni por su aparición tras abrir la política.
7. Una fase con inventario completo vacío muestra `0`; una fase desconocida o limitada muestra «Sin resultado» y su motivo.
8. Clarity y Fullstory se clasifican como servicios de mapas de calor cuando coinciden señales de catálogo con fuente oficial; la clasificación no afirma venta de datos.
9. Si móvil o escritorio queda incompleto, el informe identifica el perfil, la causa admitida y las métricas ausentes; nunca atribuye a la web los fallos del auditor.
10. Los valores de cookies, credenciales y cuerpos de solicitudes no se persisten ni aparecen en la salida pública.
11. La evidencia, contrato de datos y documentación pública se mantienen compatibles con perfiles históricos; no se reinterpretan informes ya persistidos. `privacy-v1` sigue parseándose y presentándose con su contrato histórico; informes nuevos usan la versión nueva.

## Secuencia de implementación

1. Corregir etiquetas, aritmética y cálculo de cobertura/puntuaciones en el resumen y las tarjetas.
2. Diagnosticar y corregir pérdidas o divergencias entre captura Chromium, controles, evaluaciones, persistencia y API para los criterios sin resultado.
3. Completar el contrato de salida pública para las instantáneas de aceptación/rechazo por etapa y recarga; persistir solo evidencia acotada y necesaria.
4. Presentar en el portal cantidades, cambios y coincidencias catalogadas en el resumen y el detalle.
5. Verificar casos de regresión de TalentoyPersonas y Grumphya; documentar el comportamiento terminado en `doc/` y retirar de `wanna-bes.md` los elementos efectivamente implementados.
