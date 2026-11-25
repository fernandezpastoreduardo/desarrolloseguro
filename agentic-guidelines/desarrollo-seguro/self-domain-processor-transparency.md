# Evidencia propia de procesadores para `desarrolloseguro.org`

## Propósito

Mantener la evaluación firmada del inventario backend dentro de la rúbrica vigente
`domain-ethics-v5` para el dominio de la propia entidad. Los informes de `desarrolloseguro.org` no deben volver a `domain-ethics-v3`
ni dejar `third-party-data-use` como `unknown` solo porque el lector aislado
existente está limitado a Grumphya.

La extensión no cambia pesos, criterios, redondeo ni reglas de evaluación. El
criterio existente se representa como `backend-processor-transparency` y se
resuelve con evidencia del runtime de Desarrollo Seguro, no con una afirmación
inferida de la ausencia de cookies o referencias a terceros.

## Alcance de inventario

El inventario enumera los proveedores externos que reciben, procesan o alojan
datos del servicio en producción, incluidas las plataformas de infraestructura
que almacenan la aplicación, API o base de datos. Se basa en la configuración
desplegada y el registro de integraciones activas del artefacto, y se vincula a
su digest de release.

El inventario distingue explícitamente:

- proveedores o procesadores externos que reciben esos datos, incluidos los
  proveedores de alojamiento de la plataforma;
- componentes internos de Desarrollo Seguro, incluidas la web, la API, la
  base de datos y el proxy operado por la misma entidad;
- destinos de escaneo que reciben solicitudes técnicas limitadas porque una
  persona pidió analizar ese dominio. Se documentan como destinos del análisis,
  no como procesadores de los datos de la aplicación;
- integraciones condicionales que solo se usan al analizar otro dominio, como
  la consulta autenticada de inventario de Grumphya. No se presentan como
  proveedores de la web pública de Desarrollo Seguro.

Una lista vacía solo es completa si la configuración de producción y las
pruebas demuestran que no hay ningún proveedor externo activo que reciba,
procese o aloje datos del servicio. La observación de producción confirma que
el VPS que aloja Desarrollo Seguro también ejecuta Grumphya; la política de
Grumphya identifica ese VPS como servicio de IONOS. Por tanto, IONOS debe
aparecer en el registro de Desarrollo Seguro como proveedor activo de
alojamiento. La declaración no atribuye a IONOS accesos humanos, retención
concreta ni prácticas contractuales que no estén acreditadas. SMTP y OpenAI
solo se declaran si el runtime de Desarrollo Seguro realmente los utiliza.

## Evidencia y proyección

- El origen de evidencia es local, versionado y mantenido junto al registro de
  integraciones; el informe muestra su versión y digest del release. Al añadir
  IONOS como proveedor de alojamiento, incrementa la revisión del registro a
  `v2`.
- La revisión se obtiene del argumento confiable que envía CI. Si el gateway
  remoto instalado todavía omite ese argumento, el script de despliegue puede
  recuperarla únicamente del nombre validado `gha-<40-hex>.<6-char-suffix>`
  de su directorio temporal de release. Si ninguna fuente coincide, el
  despliegue debe detenerse antes de construir imágenes o modificar servicios.
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
   `domain-ethics-v5` con 8/8 criterios éticos concluyentes.
2. `backend-processor-transparency` refleja exactamente el registro de
   integraciones activas del release y se presenta como evidencia declarada
   por Desarrollo Seguro. La persistencia acepta esta evaluación únicamente
   para `desarrolloseguro.org` y `grumphya.com`, manteniendo evidencia
   obligatoria en ambos dominios.
3. Ningún proveedor ni condición se inventa; toda lista vacía tiene una
   definición de alcance, un registro de origen y pruebas de cobertura.
4. El registro `v2` declara IONOS como proveedor activo de alojamiento, y la
   política pública lo identifica con propósito y enlaces a su política de
   privacidad, documentación de Hosting y contrato de tratamiento.
5. Un informe nuevo de la portada produce valoración ética 100/100 y global
   100/100. La cobertura de Privacidad muestra con claridad sus criterios
   evaluados y los `not_applicable` legítimos, sin `unknown`.
6. Los resultados, informes históricos, Grumphya y otros dominios no cambian
   su semántica como efecto colateral.
