# Sello verificable en el footer de DesarrolloSeguro.org

## Objetivo

Mostrar en el pie de las páginas públicas de Desarrollo Seguro la insignia
verificable correspondiente a `desarrolloseguro.org`, usando el widget público
de sellos ya existente.

## Alcance y comportamiento

- Incluir el widget en `index.html`, `metodologia.html`, `privacidad.html` y
  `sello.html`. La página `verificar.html` no lleva una segunda insignia: es el
  destino que comprueba los sellos.
- Autorizar `desarrolloseguro.org` en la identidad de emisión/verificación del
  API y en la validación del widget. Mantener las identidades autorizadas de
  Grumphya.
- La insignia aparece únicamente tras verificar en servidor el token, el
  origen, la certificación activa y el informe certificado vigente. Si falta o
  falla cualquiera de esas condiciones, se mantiene oculta.
- Usar el mismo componente visual, marca y destino verificador que el widget
  existente. No mostrar una copia estática que pueda parecer certificada.
- La emisión del token sigue siendo una operación explícita de producción y
  requiere una certificación activa con informe vigente. El token público se
  inserta en el HTML del sitio y caduca o puede revocarse según el ciclo del
  sistema (30 días).
- Ajustar las políticas CSP de las páginas afectadas para permitir el script
  local, la conexión same-origin y la imagen `blob:` usada por el widget, sin
  relajar otras directivas.
- Mantener estilos del componente en SCSS e integridad SRI de los scripts a
  través del builder público.

## Criterios de aceptación

1. Cada una de las cuatro páginas incluye una sola instancia del widget
   configurada para `desarrolloseguro.org`; la página de verificación no se
   autorreferencia.
2. El builder genera scripts con SRI y la CSP permite solo lo requerido por el
   widget. El navegador puede cargarlo y ejecutar la verificación.
3. El API emite y verifica sellos para `desarrolloseguro.org` y conserva el
   comportamiento de Grumphya; dominios ajenos siguen rechazados.
4. Sin un token válido o sin certificación activa/fresca no aparece ninguna
   insignia de aprobación. Con una verificación válida se muestra y enlaza a
   la verificación pública.
5. La documentación humana describe la ubicación del sello y las condiciones
   bajo las que aparece.
