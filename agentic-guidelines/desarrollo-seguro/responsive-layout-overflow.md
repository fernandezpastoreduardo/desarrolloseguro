# Desbordamiento horizontal en heroes

## Alcance

Evitar que las ilustraciones y elementos decorativos de los heroes de las
páginas públicas ensanchen el área de maquetado o produzcan desplazamiento
horizontal en escritorio y móvil.

La corrección se limita a la presentación responsive de `desarrollo-seguro/`.
No cambia contenido, navegación, comportamiento de la aplicación ni la
composición de las secciones fuera de lo necesario para contener sus elementos
decorativos.

## Reglas

- Las columnas del hero y su contenido deben poder reducirse hasta el ancho
  disponible sin imponer un ancho mínimo mayor que el viewport.
- Los círculos, sombras, pseudoelementos e ilustraciones decorativas no deben
  aumentar el ancho desplazable del documento.
- En móvil, los círculos de la ilustración se dimensionan respecto al espacio
  disponible; no mantienen tamaños fijos mayores que el contenedor.
- El contenido principal del hero, las tarjetas, textos y acciones permanece
  visible y accesible; la contención se aplica a la decoración que puede
  sobresalir.
- No se introduce una anchura fija de página ni se recorta contenido funcional
  para esconder el desbordamiento.

## Criterios de aceptación

1. En móvil, tablet y escritorio, el ancho desplazable no supera el ancho del
   viewport por los heroes o sus ilustraciones.
2. El titular, las acciones y la tarjeta ilustrativa permanecen dentro del
   viewport y se adaptan al ancho disponible.
3. Los adornos de heroes interiores no desplazan horizontalmente la página.
4. Se conserva la composición visual y no se alteran enlaces ni contenido.
5. El build SCSS de las páginas públicas termina correctamente.
