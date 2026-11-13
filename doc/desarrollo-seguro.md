# Desarrollo Seguro: alcance actual

Este repositorio conserva el prototipo académico de Desarrollo Seguro, una herramienta para explicar controles técnicos observables de sitios web. La aplicación ofrece una interfaz y una API para consultar informes y solicitar análisis acotados; la disponibilidad de nuevos resultados depende del runtime desplegado.

La interfaz no emite certificaciones ni sustituye una auditoría independiente. Los informes y controles disponibles tienen alcance y limitaciones documentados en [`agentic-guidelines/desarrollo-seguro/controls-and-evidence.md`](../agentic-guidelines/desarrollo-seguro/controls-and-evidence.md).

`/desarrollo-seguro/informe-grumphya-prototipo.html` es una ficha pública de demostración basada en la captura histórica que aportó el usuario. La ficha separa puntuación ética, privacidad, seguridad y rendimiento; no representa un análisis actual. El sello verificado existente solo se emite para un informe persistido y elegible, por lo que esta ficha puede enlazarse como muestra pero no emitir por sí sola un sello verificado.

El proyecto se ejecuta en un stack Docker propio, con base, API, web, redes, secretos y volumen separados. No requiere integrarse en el dominio ni en la infraestructura de otra aplicación. Consulta [Producción](production.md) para su topología.
