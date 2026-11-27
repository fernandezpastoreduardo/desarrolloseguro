# Navegación pública y Actualidad

## Objetivo

Unificar la navegación principal entre la portada, las páginas públicas y el
portal `/app/`, y añadir una sección editorial de Actualidad con una vista
resumida y páginas de lectura completa.

## Alcance

- Navegación principal común en portada, metodología, privacidad, sello,
  verificación, Actualidad, páginas de noticia y portal `/app/`.
- La secuencia de enlaces es: Inicio, Actualidad, Metodología, Privacidad y
  alcance, Sello e informes. La página actual se indica semánticamente.
- La política legal de privacidad no es una sección de la navegación
  principal. Se conserva en el footer y en el aviso de primera entrada. Cuando
  existan el formulario de contacto y el login, añadir allí enlaces pertinentes
  a la política antes de recopilar datos de esas funciones.
- La marca enlaza a la portada. En `/app/` se conserva además el selector de
  tema; en las páginas públicas se conserva el acceso al buscador.
- Ruta del índice: `/desarrollo-seguro/actualidad.html`.
- Cada noticia tiene una tarjeta compacta con titular, fecha, entradilla,
  fuente y enlace a su lectura completa en una página propia. La portada de
  Actualidad enseña varias tarjetas simultáneamente y usa una composición
  editorial inspirada en un periódico.
- El contenido completo incluye título, fecha, cuerpo organizado en secciones,
  enlaces a fuentes y regreso a Actualidad.
- Se integran los seis artículos aportados en esta conversación. Se verifican
  los hechos y se corrigen o califican afirmaciones que las fuentes no
  respalden. Se priorizan comunicados de las entidades implicadas, organismos
  públicos, autoridades competentes y textos jurídicos oficiales. Una noticia
  secundaria no se presenta como si fuera una comunicación oficial; los casos
  sin fuente primaria localizable se dejan fuera o se identifican como no
  confirmados. Si la fuente primaria es un correo privado recibido por el
  editor y no existe enlace público, se atribuye expresamente a ese aviso y se
  indica que no es consultable mediante URL.
- No se incorpora ingestión automática, comentarios, suscripciones, anuncios,
  gestión editorial, recomendaciones personalizadas ni métricas.

## Límites y privacidad

- Renderizado estático; no añade dependencias, scripts, cookies, analítica ni
  solicitudes de terceros en la carga de página.
- Los enlaces externos solo se solicitan cuando la persona decide abrirlos.
- No se modifica el comportamiento del buscador ni los resultados de auditoría.
- Los estilos nuevos y los cambios visuales se escriben en SCSS.

## Criterios de aceptación

1. Todas las vistas enumeradas muestran los mismos enlaces, etiquetas y orden
   en la navegación principal; solo varían el control contextual (tema en el
   portal y buscador en el sitio público). Las páginas con destino propio
   señalan su enlace actual; el portal no marca una página pública como actual.
2. La navegación funciona con teclado, tiene foco visible y etiqueta accesible;
   en escritorio conserva el centrado del resto de páginas. En móvil sus
   enlaces siguen disponibles sin recorte ni solapamiento.
3. En `/app/`, el texto del selector de tema queda separado del interruptor en
   todos los anchos; el botón no se comprime hasta superponer ambos elementos.
4. La portada y Actualidad enlazan entre sí y a todas las noticias; cada página
   de noticia incluye enlace de vuelta al índice.
5. El índice permite ver varias tarjetas a la vez en escritorio, se adapta a
   móvil y distingue claramente titular, fecha, resumen y lectura completa.
6. Las páginas completas mantienen una jerarquía editorial legible y citan o
   atribuyen las fuentes junto a las afirmaciones verificables. Se usan fuentes primarias y
   oficiales para describir comunicados, obligaciones legales y criterios de
   autoridades; las limitaciones de lo publicado se expresan con claridad,
   sin transformar hipótesis en hechos.
7. No se emiten peticiones externas al cargar cualquiera de estas páginas ni
   se añaden dependencias o seguimiento.
8. El build público incluye el índice y todas las páginas de artículo, con
   referencias locales válidas a estilos y recursos.
9. `doc/` explica cómo navegar Actualidad y los límites de sus artículos; la
   idea ya implementada se retira de `wanna-bes.md`.

## Fuera de alcance

Automatización de noticias, moderación, investigación de derechos de imagen,
panel de administración, comentarios, contenido generado por usuarios y
cambios en otras marcas o dominios.
