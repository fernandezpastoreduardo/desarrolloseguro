# Contraste visual del aviso inicial de cookies

## Alcance

El aviso inicial de cookies del portal `/app/` y de las páginas públicas debe
mostrar el logotipo aprobado con claridad. Se ajusta su paleta para que la
superficie de la modal sea blanca y sus textos y controles mantengan contraste
suficiente.

El cambio afecta solo a la presentación del aviso en
`apps/desarrollo-seguro/web/src/first-entry-notice/`, que también se importa
desde `desarrollo-seguro/styles.scss` para las páginas públicas. Conserva el
contenido, los enlaces, el comportamiento de cierre y almacenamiento, el uso
del diálogo nativo y el fondo oscurecido detrás de la modal.

## Reglas visuales

- La superficie de la modal es blanca y el logotipo local se presenta sin
  alteraciones.
- El texto informativo usa un color oscuro legible sobre blanco.
- El enlace de privacidad usa el turquesa oscuro aprobado y conserva su
  subrayado visible.
- El botón «Entendido» sigue la forma y jerarquía de los CTA principales de la
  web: rectangular, fondo casi negro, texto claro, tamaño compacto y tipografía
  marcada. En hover usa el turquesa oscuro de marca.
- El botón conserva estados visibles de hover y foco de teclado.
- El contorno de foco del enlace y del botón es claramente visible sobre la
  superficie blanca.
- El fondo exterior mantiene el oscurecimiento actual para separar el aviso
  del contenido de la página.

## Criterios de aceptación

1. El logotipo negro y turquesa se distingue claramente en la modal blanca.
2. El texto, enlace y botón se leen y distinguen sin depender del color como
   única señal.
3. Hover y foco de teclado siguen siendo visibles.
4. No cambian el texto, las rutas, el mecanismo de cierre ni el marcador local
   de primera visita.
5. La hoja SCSS compila y la documentación humana describe la presentación
   final.
