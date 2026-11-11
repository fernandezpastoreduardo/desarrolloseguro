# Política de evaluación ética de dominios

La evaluación presenta una puntuación provisional de 0 a 100 junto con cada criterio, su estado, el peso aplicado y las razones observadas. La puntuación resume únicamente controles con evidencia verificable en el informe; no equivale a una certificación, cumplimiento legal, auditoría integral ni garantía sobre el comportamiento interno del sitio.

## Criterios y pesos

| Criterio | Peso | Evidencia aceptada |
| --- | ---: | --- |
| Resolución DNS | 10 | Control `DS-DNS-01` del perfil ejecutado. |
| Seguridad del transporte TLS | 25 | Controles `DS-TLS-01/02` del perfil ejecutado. |
| Respuesta HTTP | 15 | Control `DS-HTTP-01` del perfil ejecutado. |
| Cabeceras de seguridad | 20 | Control `DS-HDR-01` del perfil ejecutado. |
| Reutilización o venta de datos por terceros (`DS-PRIV-04`, previsto) | 10 | Fuente verificable, atribuible al proveedor y vigente; no se infiere de una conexión de red. |
| Coincidencias del catálogo de cookies antes de interactuar (`DS-PRIV-05`) | 10 | Nombres de cookies de categorías Analytics/Marketing en cabeceras `Set-Cookie` de la respuesta inicial. |
| Rastreadores y mapas de calor (`DS-PRIV-06`, previsto) | 5 | Inventario verificable de scripts y solicitudes de la página observada. |
| Rendimiento (`DS-QUAL-02`, previsto) | 5 | Métricas identificadas, versión de metodología y condición de ejecución comparables. |

Los cuatro primeros criterios son los únicos que evalúa `transport-v1`. El perfil versionado `domain-v1` añade `DS-PRIV-05` para comparar los nombres de cookies recibidos en la respuesta inicial con el catálogo local Open Cookie Database. Solo conserva contadores agregados; el HTML, los nombres y los valores de cookies no pasan a los informes. Una coincidencia es una señal por nombre, no prueba quién emitió la cookie, que el proveedor estuviera activo ni que se vendan datos. Una respuesta sin coincidencias tampoco prueba ausencia de almacenamiento creado por JavaScript o de cookies después de interactuar. El banner no se pulsa y su texto no se interpreta como consentimiento válido. Por estos límites, consentimiento tras aceptar/rechazar, rastreadores dinámicos, mapas de calor, venta de datos y rendimiento siguen `unknown`.

## Cálculo

Los pesos son proporciones de los criterios documentados. Para los criterios observados con estado `pass` o `fail`, la puntuación es `redondear(100 × suma de pesos aprobados / suma de pesos observados)`. Los criterios `unknown`, `not_applicable`, duplicados contradictorios o ausentes se excluyen del denominador y se explican como no evaluados. Si no hay ningún criterio evaluable, no se publica número. El resumen siempre muestra la cantidad evaluada sobre el total y la interpretación provisional.

Un fallo reduce la puntuación por su peso relativo dentro de los criterios evaluados y genera una razón neutral sobre el control. Las explicaciones no amplifican evidencia ni describen datos que el scanner no recoge. No se califican cookies o rastreadores como ventas de datos sin fuentes verificables y revisión de vigencia; una futura integración de fuentes deberá publicar referencia, fecha, cobertura y confianza. Los IDs previstos distinguen estas evidencias de `DS-PRIV-01/02/03` (intentos de terceros, atributos de cookies y recursos inseguros) y `DS-QUAL-01` (respuesta/carga básica); no amplían por sí mismos el alcance ejecutado.

La versión `domain-ethics-v3` identifica este rubric, incluida la interpretación más estrecha de `DS-PRIV-05` y el requisito de evidencia completa para criterios compuestos: cada control configurado debe estar presente y pasar; un fallo observado basta para fallar el criterio, mientras que evidencia ausente, contradictoria o `unknown` lo deja sin evaluar. Los cambios de criterio o peso requieren una nueva versión y pruebas de compatibilidad. El subconjunto local del catálogo se fija al commit `7786335566460016f07a50705a92fc781c976f6f`, mantiene Analytics/Marketing, y conserva la licencia Apache-2.0 en `apps/desarrollo-seguro/worker/src/data/OPEN-COOKIE-DATABASE-LICENSE.txt`. Las categorías upstream orientan la búsqueda; no constituyen una clasificación legal ni atribuyen una cookie concreta al proveedor indicado. Para el alcance y límites del escáner, véase [scanner-safety.md](scanner-safety.md).
