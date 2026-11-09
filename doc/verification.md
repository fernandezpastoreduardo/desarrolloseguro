# Verificación y límites

Las comprobaciones principales son `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` y `pnpm test:postgres`. CI ejecuta estas puertas y un smoke de la imagen dentro de un entorno efímero.

Los tests PostgreSQL validan el esquema y operaciones contra un cluster aislado; no son una prueba de despliegue. Las políticas de Compose y TLS validan configuración y material sintético, no certificados de producción, conectividad pública, firewall, carga ni recuperación de copias.

El portal público de evaluación de sitios y su executor de escaneo no están habilitados. Ningún resultado actual debe interpretarse como certificado, auditoría independiente o garantía de seguridad de un sitio.
