# Catálogo de privacidad v3: mapas de calor

Estado: implementado en la auditoría pública, con reglas locales versionadas.

## Objetivo y límites

Ampliar el catálogo técnico para reconocer Microsoft Clarity y Fullstory como
servicios de analítica de experiencia/mapas de calor cuando las señales
observadas coincidan con sus reglas. Esta etiqueta describe la categoría
documentada del servicio; no demuestra qué funciones concretas se activaron,
qué datos se recogieron en una visita ni que exista venta o reutilización de
datos.

Las cookies solo se atribuyen al proveedor cuando el nombre coincide con la
regla y la evidencia del mismo flujo corrobora el host del servicio. El host
reconocido puede contar como solicitud a un rastreador conocido y participar
en la evaluación de cookies no esenciales previa a la elección. Los hallazgos
legales siguen requiriendo todos los elementos definidos en
[`legal-cookie-audit.md`](legal-cookie-audit.md); no se amplían artículos,
autoridades, multas ni conclusiones legales por esta clasificación.

## Reglas v3

| Proveedor | Señales locales | Categoría | Fuente oficial |
| --- | --- | --- | --- |
| Microsoft Clarity | Host `clarity.ms`; cookies `_clck`, `_clsk` (requieren corroboración del host) | `heatmap` | [CSP e instalación](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-csp); [cookies](https://learn.microsoft.com/en-us/clarity/cookie-list) |
| Fullstory | Host `fullstory.com`; cookies `fs_uid`, `fs_cid`, `fs_lua` (requieren corroboración del host) | `heatmap` | [CSP e instalación](https://help.fullstory.com/hc/en-us/articles/360020622854-Can-I-use-Content-Security-Policy-CSP-with-Fullstory); [cookies propias](https://help.fullstory.com/hc/en-us/articles/360020829513-Why-Fullstory-uses-First-Party-Cookies) |

Cada regla conserva la fuente, fecha de revisión, estado de licencia, nivel de
confianza y falsos positivos. Microsoft Learn declara CC BY 4.0; para Fullstory
se guardan identificadores y descripciones factuales con atribución al origen,
sin copiar su documentación ni afirmar una licencia de redistribución.

## Criterios de aceptación

1. La coincidencia del host se limita al nombre de dominio o sus subdominios
   válidos; un sufijo parecido o un host suplantado no coincide.
2. Una cookie de Clarity o Fullstory sin host corroborante no se atribuye.
3. Las reglas v3 aparecen como categoría «Mapa de calor» en el inventario y
   cuentan en comprobaciones de actividad no esencial donde corresponda.
4. Detectar Clarity o Fullstory no produce una afirmación de venta, cesión o
   reutilización de datos.
5. Ninguna regla v2 o lectura histórica se reescribe; los informes conservan
   su clasificación original.
6. No se añaden dependencias, solicitudes del auditor a esos proveedores,
   nombres de cookie al margen del allowlist, ni valores de cookies.
