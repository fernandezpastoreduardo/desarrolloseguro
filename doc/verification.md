# Verificación y límites

Las comprobaciones principales son `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` y `pnpm test:postgres`. CI ejecuta estas puertas y un smoke de la imagen dentro de un entorno efímero.

Los tests PostgreSQL validan el esquema y operaciones contra un cluster aislado; no son una prueba de despliegue. Las políticas de Compose y TLS validan configuración y material sintético, no certificados de producción, conectividad pública, firewall, carga ni recuperación de copias.

La interfaz y la API permiten solicitar y poner en cola un análisis autorizado. Tras encolarlo, el portal consulta el estado de forma limitada y muestra el informe cuando queda guardado. La certificación beta se persiste junto al informe y el sello público solo se verifica si el estado es `active` y el informe coincide con el certificado vigente. El worker y el coordinador están definidos en Compose; la validación del ciclo completo en el VPS requiere el deploy de esta fase. Las pruebas de fixture en PostgreSQL aislado no usan red externa. Ningún resultado debe interpretarse como auditoría independiente ni garantía de seguridad de un sitio.
