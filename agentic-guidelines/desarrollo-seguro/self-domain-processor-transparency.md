# Evidencia propia de procesadores para `desarrolloseguro.org`

## Propósito

Aplicar la semántica ya aprobada de `domain-ethics-v4` al dominio de la propia
entidad. Los informes de `desarrolloseguro.org` no deben volver a `domain-ethics-v3`
ni dejar `third-party-data-use` como `unknown` solo porque el lector aislado
existente está limitado a Grumphya.

La extensión no cambia pesos, criterios, redondeo ni reglas de evaluación. El
criterio existente se representa como `backend-processor-transparency` y se
resuelve con evidencia del runtime de Desarrollo Seguro, no con una afirmación
inferida de la ausencia de cookies o referencias a terceros.

## Alcance de inventario

El inventario enumera integraciones backend de producción que reciben o
procesan datos proporcionados por las personas usuarias o datos de sus
informes. Se basa en el registro de integraciones activas del artefacto
desplegado y se vincula a su digest de release.

El inventario distingue explícitamente:

- proveedores o procesadores externos que reciben esos datos;
- componentes internos de Desarrollo Seguro, incluidas la web, la API, la
  base de datos y el proxy operado por la misma entidad;
- destinos de escaneo que reciben solicitudes técnicas limitadas porque una
  persona pidió analizar ese dominio. Se documentan como destinos del análisis,
  no como procesadores de los datos de la aplicación;
- integraciones condicionales que solo se usan al analizar otro dominio, como
  la consulta autenticada de inventario de Grumphya. No se presentan como
  proveedores de la web pública de Desarrollo Seguro.

Una lista vacía solo es completa si el registro de producción y las pruebas
demuestran que no hay integraciones externas activas dentro del alcance
declarado. No afirma que no existan proveedores de infraestructura fuera de ese
alcance ni verifica contratos, retención o prácticas de terceros. Esas
limitaciones deben figurar en la explicación pública y no se rellenan con
suposiciones. OpenAI solo se declara como integración si el runtime de este
producto realmente le transmite datos.

## Evidencia y proyección

- El origen de evidencia es local, versionado y mantenido junto al registro de
  integraciones; el informe muestra su versión y digest del release.
- El inventario no se obtiene desde el navegador, no contacta proveedores y no
  necesita secretos de runtime para compilarse.
- Si se declara un proveedor activo, la proyección pública contiene únicamente
  identificador/nombre, producto, propósito declarado, estado de divulgación y
  enlace a la política publicada por Desarrollo Seguro.
- Las declaraciones se atribuyen a Desarrollo Seguro. No se afirman como
  verificaciones independientes ni se atribuyen a OpenAI, al hoster u otro
  proveedor condiciones no documentadas.
- El inventario completo vacío puede producir `pass`. Una integración activa
  no declarada o una declaración publicada que la omita produce `fail`.
  Evidencia ausente, inconsistente o no ligada al release produce `unknown` y
  bloquea el objetivo de 100/100; nunca se fuerza un estado favorable.
- Los informes históricos conservan su rúbrica y contenido originales.

## Privacidad y controles existentes

La dimensión de Privacidad conserva sus propios criterios. Para la portada sin
banner, proveedores de consentimiento ni señales de seguimiento, los cuatro
criterios condicionales pueden seguir como `not_applicable`; no se añade un
banner ficticio para aumentar cobertura. El criterio que sí aplica debe
conservar evidencia suficiente para `100/100` de esa dimensión.

No se publican valores de cookies, tokens, cabeceras de autorización, prompts,
IPs de visitantes, cuerpos de solicitudes ni detalles internos de red. Los
nombres y dominios de proveedores solo aparecen cuando formen parte de la
allowlist del inventario.

## Criterios de aceptación

1. Los análisis actuales y periódicos de `desarrolloseguro.org` usan
   `domain-ethics-v4` con 8/8 criterios éticos concluyentes.
2. `backend-processor-transparency` refleja exactamente el registro de
   integraciones activas del release y se presenta como evidencia declarada
   por Desarrollo Seguro.
3. Ningún proveedor ni condición se inventa; toda lista vacía tiene una
   definición de alcance, un registro de origen y pruebas de cobertura.
4. Un informe nuevo de la portada produce valoración ética 100/100 y global
   100/100. La cobertura de Privacidad muestra con claridad sus criterios
   evaluados y los `not_applicable` legítimos, sin `unknown`.
5. Los resultados, informes históricos, Grumphya y otros dominios no cambian
   su semántica como efecto colateral.
