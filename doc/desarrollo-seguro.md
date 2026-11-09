# Desarrollo Seguro: alcance actual

Este repositorio conserva el prototipo académico de Desarrollo Seguro, una herramienta para explicar controles técnicos observables de sitios web. La aplicación ofrece una interfaz y una API de consulta; la ejecución automatizada de escaneos no está habilitada.

La interfaz no emite certificaciones ni sustituye una auditoría independiente. Los informes y controles disponibles tienen alcance y limitaciones documentados en [`agentic-guidelines/desarrollo-seguro/controls-and-evidence.md`](../agentic-guidelines/desarrollo-seguro/controls-and-evidence.md).

El proyecto se ejecuta en un stack Docker propio, con base, API, web, redes, secretos y volumen separados. No requiere integrarse en el dominio ni en la infraestructura de otra aplicación. Consulta [Producción](production.md) para su topología.
