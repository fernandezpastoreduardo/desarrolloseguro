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
| Cookies no técnicas y consentimiento (`DS-PRIV-05`, previsto) | 10 | Inspección del estado antes de elección y después de cada opción de consentimiento. |
| Rastreadores y mapas de calor (`DS-PRIV-06`, previsto) | 5 | Inventario verificable de scripts y solicitudes de la página observada. |
| Rendimiento (`DS-QUAL-02`, previsto) | 5 | Métricas identificadas, versión de metodología y condición de ejecución comparables. |

Los cuatro primeros criterios son los únicos que puede evaluar el perfil `transport-v1`. `DS-PRIV-04`, `DS-PRIV-05`, `DS-PRIV-06` y `DS-QUAL-02` son identificadores previstos para incorporar evidencia futura al rubric; no forman parte de `transport-v1`, ni el scanner actual los emite o evalúa. Por ello se muestran como `unknown` en sus informes. No observar una cookie o conexión en una petición aislada no prueba su ausencia en el sitio completo.

## Cálculo

Los pesos son proporciones de los criterios documentados. Para los criterios observados con estado `pass` o `fail`, la puntuación es `redondear(100 × suma de pesos aprobados / suma de pesos observados)`. Los criterios `unknown`, `not_applicable`, duplicados contradictorios o ausentes se excluyen del denominador y se explican como no evaluados. Si no hay ningún criterio evaluable, no se publica número. El resumen siempre muestra la cantidad evaluada sobre el total y la interpretación provisional.

Un fallo reduce la puntuación por su peso relativo dentro de los criterios evaluados y genera una razón neutral sobre el control. Las explicaciones no amplifican evidencia ni describen datos que el scanner no recoge. No se califican cookies o rastreadores como ventas de datos sin fuentes verificables y revisión de vigencia; una futura integración de fuentes deberá publicar referencia, fecha, cobertura y confianza. Los IDs previstos distinguen estas evidencias de `DS-PRIV-01/02/03` (intentos de terceros, atributos de cookies y recursos inseguros) y `DS-QUAL-01` (respuesta/carga básica); no amplían por sí mismos el alcance ejecutado.

La versión `domain-ethics-v1` identifica este rubric. Los cambios de criterio o peso requieren una nueva versión y pruebas de compatibilidad. Para las limitaciones y el alcance del escáner, véase [scanner-safety.md](scanner-safety.md).
