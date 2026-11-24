# Servicios externos en la ficha pública

La ficha presenta la misma comparación pública para cualquier dominio. Reúne
los servicios que se observaron desde fuera, lo que el sitio declara y fuentes
públicas oficiales de cada proveedor identificado. El bloque adicional de
información interna que comparten algunos clientes certificados se muestra por
separado y no cambia esta comparación ni su nota.

## Cómo se lee

Una solicitud externa completada cuyo proveedor no se pudo atribuir aparece
como **Destino externo sin proveedor atribuido**, con el dominio observado y
una entrada persistente en la versión del catálogo. Si las fuentes permitidas
no localizaron documentación oficial, el informe lo dice expresamente; ese
estado no afirma que la documentación no exista. Cuando un enlace oficial se
localizó pero no respondió, conserva el enlace y el estado técnico. La sección
de catálogo muestra la versión y la fecha/hash de las fuentes recuperadas.

- **Correcto · observado y explicado:** se observó una conexión con un
  proveedor y la información pública del sitio identifica ese servicio y
  explica para qué se usa. La ficha enlaza la descripción y la política de
  privacidad públicas del proveedor. El enlace atribuye al proveedor sus
  propias declaraciones; no afirma que el auditor haya inspeccionado sus
  sistemas internos.
- **Riesgo detectado:** se observó un proveedor sin una explicación pública
  suficiente, o faltó información pública necesaria para entender qué
  servicios usa el sitio. Esta falta de transparencia reduce la nota común de
  Ética.
- **Ilegalidad detectada:** se reserva para una práctica que coincida con una
  norma europea concreta y una señal directa, reproducible y suficiente. La
  ficha debe mostrar la norma aplicable. Un proveedor desconocido o una
  sospecha no bastan para usar este rótulo.
- **En revisión:** se usa solo cuando un error o límite del sistema de auditoría
  impide completar la comprobación. No se atribuye ese error al dominio.
- Una declaración que no se observó durante la navegación se muestra como
  declaración, sin presentarla como actividad confirmada y sin penalizarla por
  sí sola.

La evidencia del navegador puede incluir conexiones de terceros y nombres de
cookies, pero nunca valores de cookies, cuerpos de peticiones, parámetros de
URL ni datos personales. Las señales sin identificación fiable se muestran
como indicios; no se penalizan automáticamente.

## Resumen y diseño

La cabecera coloca el gráfico de la nota global a la izquierda y un resumen en
lenguaje cotidiano a la derecha. El resumen destaca fortalezas y riesgos sin
repetir puntuaciones o métricas técnicas. Las tarjetas de dimensiones no
repiten mensajes genéricos como «No se detectaron problemas». En móvil, el
margen horizontal exterior y el de los bloques de contenido es de 10 px.

Los servicios internos que un titular certificado decide compartir se
identifican como información adicional aportada desde su aplicación. Se
enumeran en un bloque independiente, porque no están disponibles para todos
los dominios y no forman parte de la comparación pública común.

## Fuentes públicas de proveedores

La ficha ofrece enlaces a páginas oficiales del proveedor sobre el servicio y
su política de privacidad. Los resúmenes de proveedores conocidos proceden de
un catálogo local revisado y versionado en el repositorio; indican qué declara
el proveedor, sin presentar sus declaraciones como hechos verificados sobre
una cuenta o configuración concreta. Durante el análisis, el auditor puede
consultar páginas de privacidad, cookies y condiciones enlazadas públicamente
por el propio sitio, también cuando están alojadas en otro dominio. La ficha
no carga los enlaces del catálogo al abrir el informe ni envía datos del
informe a esos proveedores; el proveedor solo recibe una conexión del lector
si la persona abre uno de los enlaces.

El objetivo de la puntuación no es medir una opinión moral. Las dimensiones
organizan controles observables de seguridad, privacidad, transparencia,
rendimiento y otros aspectos que afectan a las personas. Cada criterio explica
la señal observada y la consecuencia posible en lenguaje llano.
