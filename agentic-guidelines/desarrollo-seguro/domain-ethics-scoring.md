# Política de evaluación ética de dominios

La evaluación presenta una puntuación provisional de 0 a 100 junto con cada criterio, su estado, el peso aplicado y las razones observadas. La puntuación resume únicamente controles con evidencia verificable en el informe; no equivale a una certificación, cumplimiento legal, auditoría integral ni garantía sobre el comportamiento interno del sitio.

## Criterios y pesos

| Criterio | Peso | Evidencia aceptada |
| --- | ---: | --- |
| Resolución DNS | 10 | Control `DS-DNS-01` del perfil ejecutado. |
| Seguridad del transporte TLS | 25 | Controles `DS-TLS-01/02` del perfil ejecutado. |
| Respuesta HTTP | 15 | Control `DS-HTTP-01` del perfil ejecutado. |
| Cabeceras de seguridad | 20 | Control `DS-HDR-01` del perfil ejecutado. |
| Transparencia de procesadores backend (`DS-PRIV-04`) | 10 | Inventario autenticado, firmado y vigente de integraciones de producción; se compara la lista de proveedores activos con lo declarado en la política publicada, sin juzgar si esas declaraciones son verdaderas. |
| Coincidencias del catálogo de cookies antes de interactuar (`DS-PRIV-05`) | 10 | Nombres de cookies de categorías Analytics/Marketing en cabeceras `Set-Cookie` de la respuesta inicial. |
| Referencias a rastreadores conocidos (`DS-PRIV-06`) | 5 | Conteos de referencias de terceros y de hosts de seguimiento conocidos en el HTML inicial; no confirma conexiones. |
| Rendimiento inicial (`DS-QUAL-02`) | 5 | Tiempo y tamaño de la respuesta GET inicial. Es una señal provisional, no mide experiencia del visitante. |

Los cuatro primeros criterios son los únicos que evalúa `transport-v1`. `domain-v1` añade `DS-PRIV-05`; `domain-v2` agrega `DS-PRIV-06` y `DS-QUAL-02`; el perfil actual `domain-v3` añade `DS-TLS-02` para comprobar por separado la aceptación de TLS 1.0, 1.1, 1.2 y 1.3. `DS-PRIV-06` cuenta referencias a terceros y a una lista local de hosts conocidos de seguimiento en el marcado inicial. No ejecuta scripts, confirma conexiones ni detecta todos los rastreadores; un cero solo significa que no aparecieron referencias conocidas en el HTML observado. `DS-QUAL-02` registra tiempo y bytes de una única respuesta GET desde el VPS; más de 2.500 ms se considera fallo provisional. No evalúa Core Web Vitals, carga de recursos ni experiencia de visitantes. En ambos casos solo se persisten agregados; el HTML y las URLs no pasan al informe. El banner no se pulsa y su texto no se interpreta como consentimiento válido.

## Cálculo

Los pesos son proporciones de los criterios documentados. Para los criterios observados con estado `pass` o `fail`, la puntuación es `redondear(100 × suma de pesos aprobados / suma de pesos observados)`. Los criterios `unknown`, `not_applicable`, duplicados contradictorios o ausentes se excluyen del denominador y se explican como no evaluados. Si no hay ningún criterio evaluable, no se publica número. El resumen siempre muestra la cantidad evaluada sobre el total y la interpretación provisional.

Un fallo reduce la puntuación por su peso relativo dentro de los criterios evaluados y genera una razón neutral sobre el control. Las explicaciones no amplifican evidencia ni describen datos que el scanner no recoge. El umbral de 2.500 ms es una política provisional y se muestra como tal.

`domain-ethics-v3` identifica la rúbrica anterior. `domain-ethics-v4` conserva criterios y pesos, pero redefine `DS-PRIV-04` como transparencia de procesadores backend: inventario completo con todos los proveedores activos declarados, o inventario completo vacío, produce `pass`; proveedor activo no declarado o inventario válido marcado `incomplete` produce `fail`; un error atribuible al auditor produce `unknown`. Las declaraciones de la política se presentan como declaraciones del titular y no se contrastan con contratos o términos externos. Cada informe debe conservar su versión y evidencia para que las lecturas históricas no cambien al actualizar el evaluador. Ambas versiones exigen evidencia completa para criterios compuestos: cada control configurado debe estar presente y pasar; un fallo observado basta para fallar el criterio, mientras que evidencia ausente, contradictoria o `unknown` lo deja sin evaluar. Los cambios de criterio o peso requieren una nueva versión y pruebas de compatibilidad. El subconjunto local del catálogo se fija al commit `7786335566460016f07a50705a92fc781c976f6f`, mantiene Analytics/Marketing, y conserva la licencia Apache-2.0 en `apps/desarrollo-seguro/worker/src/data/OPEN-COOKIE-DATABASE-LICENSE.txt`. Las categorías upstream orientan la búsqueda; no constituyen una clasificación legal ni atribuyen una cookie concreta al proveedor indicado. Para el alcance y límites del escáner, véase [scanner-safety.md](scanner-safety.md).

## Presentación por categorías

El informe público agrupa los criterios en **Ética** (referencias conocidas y transparencia de procesadores), **Privacidad** (cookies de la respuesta inicial), **Seguridad** (DNS, TLS, HTTP y protecciones del navegador) y **Rendimiento** (respuesta inicial). Cada criterio incluye qué comprueba, qué significa el resultado y qué revisar. La categoría solo muestra una nota numérica si todos sus criterios tienen resultado evaluable; si faltan datos se presenta como evaluación parcial con el recuento de aspectos evaluados, evitando convertir una cobertura baja en un aparente 100/100. El resumen general declara cuántos aspectos se midieron y cuántos siguen sin datos. Las recomendaciones orientan una revisión y no sustituyen una auditoría.
