# Desarrollo Seguro: alcance actual

Desarrollo Seguro publica páginas de presentación, metodología, privacidad y alcance, información sobre el sello verificable y un portal para consultar informes. El portal permite pegar una dirección web con o sin esquema —si falta, añade HTTPS— o abrirla desde un enlace directo; la consulta lee el estado guardado y no inicia un análisis. La ruta y la query se conservan y el fragmento se elimina. Para solicitar un análisis, la persona debe confirmar que tiene autorización. La disponibilidad de nuevos resultados depende del servicio desplegado.

La portada ofrece enlaces a los informes públicos actuales de `grumphya.com` y `desarrolloseguro.org`. Cada informe conserva sus datos, puntuaciones, categorías, estados y clasificaciones; el portal permite consultar su evidencia y alcance. La ficha estática de prototipo se retiró porque sus cifras eran históricas y no representaban un informe vigente.

El sello verificable enlaza con el informe actual y permite comprobar su estado. Solo acredita el vínculo y vigencia mostrados por la comprobación; el informe describe su alcance concreto y no sustituye una auditoría integral.

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
