# Desarrollo Seguro: alcance actual

Este repositorio conserva el prototipo académico de Desarrollo Seguro, una herramienta para explicar controles técnicos observables de sitios web. La aplicación ofrece una interfaz y una API para consultar informes y solicitar análisis acotados; la disponibilidad de nuevos resultados depende del runtime desplegado.

La interfaz no emite certificaciones ni sustituye una auditoría independiente. Los informes y controles disponibles tienen alcance y limitaciones documentados en [`agentic-guidelines/desarrollo-seguro/controls-and-evidence.md`](../agentic-guidelines/desarrollo-seguro/controls-and-evidence.md).

`/desarrollo-seguro/informe-grumphya-prototipo.html` es una ficha pública de demostración para explicar cómo las evidencias de seguridad, privacidad, calidad y rendimiento pueden contribuir a una valoración ética comprensible. Separa la captura web histórica (64/100, 4 de 8 criterios) de las métricas de calidad documentadas por el TFM Grumphya y la referencia Lighthouse aportada por el titular; no las suma ni representa un análisis actual. La ficha puede enlazarse como muestra. El sello verificado existente solo se emite para un informe persistido y elegible, por lo que esta página no emite por sí sola un sello verificado.

El proyecto se ejecuta en un stack Docker propio, con base, API, web, redes, secretos y volumen separados. No requiere integrarse en el dominio ni en la infraestructura de otra aplicación. Consulta [Producción](production.md) para su topología.
