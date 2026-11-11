# Verificación y límites

Las comprobaciones principales son `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` y `pnpm test:postgres`. CI ejecuta estas puertas y un smoke de la imagen dentro de un entorno efímero.

Los tests PostgreSQL validan el esquema y operaciones contra un cluster aislado; no son una prueba de despliegue. Las políticas de Compose y TLS validan configuración y material sintético, no certificados de producción, conectividad pública, firewall, carga ni recuperación de copias.

La interfaz y la API permiten solicitar y poner en cola un análisis autorizado, pero el worker no forma parte del despliegue y no se realizan conexiones a los dominios solicitados. El análisis con fixture en PostgreSQL aislado no usa red externa. Ningún resultado debe interpretarse como certificado, auditoría independiente o garantía de seguridad de un sitio.
