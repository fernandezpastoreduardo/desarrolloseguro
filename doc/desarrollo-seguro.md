# Desarrollo Seguro: alcance actual

Este repositorio conserva el prototipo académico de Desarrollo Seguro, una herramienta para explicar controles técnicos observables de sitios web. La aplicación ofrece una interfaz y una API para consultar informes y solicitar análisis acotados; la disponibilidad de nuevos resultados depende del runtime desplegado.

La interfaz no emite certificaciones ni sustituye una auditoría independiente. Los informes y controles disponibles tienen alcance y limitaciones documentados en [`agentic-guidelines/desarrollo-seguro/controls-and-evidence.md`](../agentic-guidelines/desarrollo-seguro/controls-and-evidence.md).

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
hasta 400 eventos de red por flujo, con un máximo de 64 MiB recibidos. Si el auditor bloquea una solicitud, el
informe la distingue de las comunicaciones que llegaron a recibir respuesta.

El informe separa cookies acreditadas antes de elegir de las que permanecen tras rechazar y recargar. Para una cookie propia que persiste, la atribución al proveedor puede apoyarse en una solicitud del mismo flujo antes de elegir, siempre que coincidan el nombre y dominio de la cookie en las instantáneas completas; el informe muestra esa fase de corroboración. Las solicitudes que el auditor bloquea se identifican como intentos y no como datos transmitidos.

`/desarrollo-seguro/informe-grumphya-prototipo.html` es una ficha pública de demostración para explicar cómo las evidencias de seguridad, privacidad, calidad y rendimiento pueden contribuir a una valoración ética comprensible. Separa la captura web histórica (64/100, 4 de 8 criterios) de las métricas de calidad documentadas por el TFM Grumphya y la referencia Lighthouse aportada por el titular; no las suma ni representa un análisis actual. La ficha puede enlazarse como muestra. El sello verificado existente solo se emite para un informe persistido y elegible, por lo que esta página no emite por sí sola un sello verificado.

El proyecto se ejecuta en un stack Docker propio, con base, API, web, redes, secretos y volumen separados. No requiere integrarse en el dominio ni en la infraestructura de otra aplicación. Consulta [Producción](production.md) para su topología.
