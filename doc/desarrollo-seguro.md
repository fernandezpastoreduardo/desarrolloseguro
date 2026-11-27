# Desarrollo Seguro: alcance actual

Desarrollo Seguro publica páginas de presentación, metodología, privacidad y alcance, información sobre el sello verificable y un portal para consultar informes. El portal permite pegar una dirección web con o sin esquema —si falta, añade HTTPS— o abrirla desde un enlace directo. Si se consulta una URL sin informe, inicia automáticamente el análisis y muestra el resultado al completarse; al consultar una URL con informe, muestra lo guardado. La ruta y la query se conservan y el fragmento se elimina. Para pedir una revisión nueva de una URL que ya tiene informe, la persona debe confirmar que tiene autorización. Mientras se ejecuta el análisis, el portal actualiza el estado sin recargar y muestra por separado el progreso de Ética, Privacidad, Seguridad y Rendimiento.

La navegación principal mantiene los mismos cinco destinos y el mismo orden en la portada, las páginas informativas, Actualidad y el portal `/app/`: Inicio, Actualidad, Metodología, Privacidad y alcance, Sello e informes. El portal conserva además su selector de tema; el sitio público conserva el acceso al buscador.

Actualidad se encuentra en `/desarrollo-seguro/actualidad.html`. Presenta seis artículos en tarjetas de estilo periodístico y cada tarjeta abre una página con la lectura completa y enlaces a las fuentes. Los artículos se redactan de forma manual y contrastan las afirmaciones con comunicaciones de las entidades u organismos, textos legales, autoridades oficiales y documentación primaria del estándar citado. En incidentes con investigación abierta, el artículo diferencia datos potencialmente afectados de hechos confirmados. La sección no agrega servicios de analítica, cookies ni solicitudes externas al cargar la página; un proveedor externo solo recibe una solicitud cuando la persona abre voluntariamente su enlace.

El dossier de incidentes incluye una selección, no un registro exhaustivo: solo publica los casos para los que se localizó una comunicación directa de la entidad u organismo y deja fuera las afirmaciones que no pudo confirmar en una fuente primaria. La edición y actualización de las noticias es manual; la automatización y el panel editorial siguen aplazados.

La portada muestra `grumphya.com` y `desarrolloseguro.org` como sitios certificados y enlaza con el resultado vigente de cada uno. El buscador permite consultar cualquier URL válida. Cada informe conserva sus datos, puntuaciones, categorías, estados y clasificaciones; las modales de categoría presentan estados y evidencias técnicas con contraste legible en tema claro y oscuro. La ficha estática de prototipo se retiró porque sus cifras eran históricas y no representaban un informe vigente.

La nota de Rendimiento promedia móvil y escritorio. La puntuación móvil sigue los pesos y curvas de Lighthouse 13.6.0 sobre métricas medidas por nuestro Chromium; Speed Index se estima con fotogramas acotados y TBT con la ventana de interactividad. Escritorio conserva la rúbrica anterior. No es un resultado oficial de Lighthouse.

La tarjeta de Rendimiento muestra también cada nota por separado: Móvil y Ordenador, ambas sobre 100. Mientras se actualizan, mantiene visibles las notas anteriores y añade el estado de carga correspondiente a cada perfil; si una puntuación no está disponible, no la sustituye por cero.

El bloque de inventario backend se titula «Servicios externos utilizados por Grumphya» o «Servicios externos utilizados por Desarrollo Seguro», según el informe. Se omite el resumen que aparecía inmediatamente bajo el título; el inventario, las declaraciones y el detalle comparativo siguen disponibles.

Cada proveedor aparece contraído con su nombre y producto visibles. Cuando hay una comparación pública, sus observaciones, finalidades y fuentes oficiales se integran en el desplegable del proveedor correspondiente. Los servicios que solo aparecen en la comparación también tienen su propio desplegable. El resumen general, la versión del catálogo y los dominios externos sin atribución quedan en «Cómo se revisa la información».

En el informe, la tarjeta de Ética aparece titulada «Legalidad». Las cuatro tarjetas muestran sus criterios sin un párrafo de resumen redundante. Durante una actualización, cada criterio visible indica si está pendiente o en curso; Rendimiento muestra ese estado por separado para móvil y escritorio.

Cuando esos criterios se aprueban, las filas de evidencia muestran «Sin cookies no esenciales instaladas antes de que el usuario las consienta o las rechace.» y «Sin rastreadores conocidos en la página». Si no se aprueban, el informe mantiene etiquetas que no afirman que estén ausentes.

La tarjeta de Seguridad muestra los cuatro criterios, en orden: «El dominio tiene una dirección pública en Internet», «La web protege los datos que envía el usuario», «La web devuelve el contenido de forma segura» y «La web cuenta con protección ante ataques desde el navegador». La fila de transparencia usa el título «Transparencia con los servicios externos usados por la página».

El portal admite los informes vigentes `domain-v5` del adaptador `domain-v5-network-adapter-2`, incluidos sus bloques de transparencia de políticas, comparación de servicios externos y evaluación ética v6.

El sello verificable enlaza con el informe actual y permite comprobar su estado. Solo acredita el vínculo y vigencia mostrados por la comprobación; el informe describe su alcance concreto y no sustituye una auditoría integral. El footer de las páginas públicas incluye el sello de `desarrolloseguro.org`, que solo se muestra tras verificar el token y una certificación activa con informe vigente; la página de verificación no repite el sello.

La visita pública no usa analítica, cookies no esenciales ni envía datos de visitantes a servicios externos desde el navegador. El inventario de proveedores de infraestructura y los destinos observados durante los análisis se explican por separado en la página de privacidad y alcance.

La comprobación de acceso inicial a la política conserva el resultado observado y, cuando se abre el documento durante el flujo, las instantáneas acotadas de cookies y almacenamiento del navegador antes y después de esa navegación. La persistencia valida el resultado y las instantáneas junto con el informe.

## Auditoría de cookies

La revisión usa un navegador limpio y registra por separado la visita inicial,
la elección de aceptar o rechazar y la recarga posterior. Así puede mostrar
cookies y peticiones observadas antes y después de la decisión. Tras cargar
la página busca durante un máximo de cinco segundos los avisos que se montan
de forma asíncrona. Los botones
independientes de consentimiento que omiten `type` se pueden pulsar aunque
HTML les asigne por defecto el tipo `submit`; los controles dentro de un
formulario no se envían. Cada análisis admite hasta 1.000 solicitudes y conserva
hasta 400 eventos de red por flujo, con un máximo de 64 MiB recibidos y una
respuesta JSON de navegador limitada a 1 MiB. Si el auditor bloquea una
solicitud, el informe la distingue de las comunicaciones que llegaron a recibir
respuesta.

El informe separa cookies acreditadas antes de elegir de las que permanecen tras rechazar y recargar. Para una cookie propia que persiste, la atribución al proveedor puede apoyarse en una solicitud del mismo flujo antes de elegir, siempre que coincidan el nombre y dominio de la cookie en las instantáneas completas; el informe muestra esa fase de corroboración. Las solicitudes que el auditor bloquea se identifican como intentos y no como datos transmitidos. La evaluación legal usa las observaciones de forma independiente de la puntuación de privacidad, para que un fallo de cálculo de la nota no elimine hallazgos acreditados.

El proyecto se ejecuta en un stack Docker propio, con base, API, web, redes, secretos y volumen separados. No requiere integrarse en el dominio ni en la infraestructura de otra aplicación. Consulta [Producción](production.md) para su topología.
