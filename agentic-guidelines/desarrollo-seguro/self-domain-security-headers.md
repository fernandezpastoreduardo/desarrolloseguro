# Conformidad de cabeceras de `desarrolloseguro.org`

## Propósito y alcance

El dominio público debe superar `DS-HDR-01` según la rúbrica existente
`security-headers-v1`, sin cambiar esa rúbrica ni duplicar cabeceras entre el
proxy compartido y el contenedor web. Se incluye `/`, el portal `/app/` y la
página pública `/desarrollo-seguro/verificar.html`, que son los documentos
HTML con uso de JavaScript o alcance directo para las personas.

El proxy Caddy público es la única fuente de HSTS, `X-Content-Type-Options`,
`X-Frame-Options` y `Referrer-Policy`. Nginx no vuelve a emitir esos mismos
campos. La aplicación conserva la responsabilidad de su CSP y de cualquier
cabecera que no proporcione Caddy. No se modifica la configuración ni el
despliegue del proxy perteneciente a otra aplicación.

## Política de scripts

- La CSP aplicada debe satisfacer literalmente `security-headers-v1`:
  `default-src`, `object-src`, `base-uri`, `frame-ancestors` y `form-action`
  mantienen los valores restringidos de la rúbrica; `script-src` contiene solo
  hashes o nonces válidos y, opcionalmente, `'strict-dynamic'`.
- Los scripts externos servidos por el propio dominio deben llevar un atributo
  SRI que coincida con el hash autorizado por la CSP. No se autoriza `'self'`,
  `unsafe-inline`, comodines ni orígenes externos en `script-src`.
- La política se genera a partir de los artefactos JavaScript efectivos del
  build, incluidos el bundle de la SPA y `verificar.js`. Un cambio de contenido
  debe actualizar automáticamente el SRI y la CSP del artefacto desplegado.
- Las páginas estáticas sin scripts permanecen sin JavaScript. No se añaden
  scripts vacíos o decorativos para satisfacer la rúbrica.
- La política efectiva puede ser más restrictiva por la composición de
  cabeceras del proxy y la aplicación; cualquier script legítimo debe seguir
  funcionando bajo todas las políticas aplicadas.

## Privacidad y datos

La implementación no añade dependencias, telemetría, cookies, solicitudes a
terceros ni almacenamiento nuevo. El CSS continúa en Sass y el laboratorio
Lighthouse permanece aislado, local y sin recursos externos.

## Criterios de aceptación

1. La respuesta pública final presenta una sola instancia de cada cabecera
   evaluada que exige unicidad; `DS-HDR-01` devuelve `pass`.
2. El build genera hashes y atributos SRI reproducibles para todos los
   elementos `<script src>` de las páginas incluidas.
3. La SPA y la página de verificación cargan y completan sus flujos sin
   violaciones CSP en escritorio y móvil; las páginas sin scripts no ejecutan
   código.
4. Las pruebas locales y E2E verifican carga de recursos, integridad, CSP y
   ausencia de dependencias externas. Lighthouse mantiene sus umbrales
   existentes en escritorio y móvil.
5. Una nueva lectura de `desarrolloseguro.org` no presenta `nosniff=false` ni
   `csp=false`.
