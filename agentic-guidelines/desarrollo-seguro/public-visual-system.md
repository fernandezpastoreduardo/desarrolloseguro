# Sistema visual público unificado

## Alcance de la primera iteración

El portal React de consulta (`/app/`) comparte identidad visual con las páginas
públicas generadas desde `desarrollo-seguro/`. Esta iteración solo alinea el
encabezado, los tokens Sass y las transiciones del portal; no cambia el contrato
de la API, el flujo de consulta ni el contenido de los informes.

El logotipo local aprobado es el único recurso de marca que se reutiliza. El
portal no carga fuentes, iconos, analítica ni recursos de terceros.

## Reglas

- El acento es el turquesa oscuro del sitio público (`#007e79`) y su variante
  de contraste (`#004b49`).
- El fondo papel, la tinta, la línea y la tipografía deben seguir los tokens de
  `desarrollo-seguro/styles.scss`.
- El encabezado del portal muestra el SVG local, navegación a las páginas
  públicas y el control de tema existente.
- Las animaciones son cortas, decorativas y desaparecen con
  `prefers-reduced-motion: reduce`.
- Los estados funcionales del portal conservan su marcado semántico y sus
  nombres accesibles.

## Criterios de aceptación

1. El portal muestra el logotipo local con texto alternativo accesible.
2. El encabezado enlaza con inicio, metodología, privacidad, sello y buscador
   sin crear navegación externa.
3. El portal usa los tokens de color y tipografía definidos por la identidad
   pública, sin dependencias nuevas.
4. Las pruebas de navegador comprueban el logotipo, la navegación local y la
   ausencia de peticiones a terceros.
5. Con movimiento reducido, las transiciones y la animación de progreso no
   fuerzan movimiento continuo.
