# Verificación y cobertura

El repositorio no conserva una cifra de cobertura vigente. Las pruebas y los umbrales deben corresponder al código de Desarrollo Seguro, no a resultados históricos de otros paquetes.

Las puertas actuales son:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:postgres
```

`pnpm test:postgres` requiere una base temporal dedicada y las variables `DS_TEST_POSTGRES_ISOLATED=1` y `DS_TEST_DATABASE_URL`. No apunta a la base local de desarrollo ni a producción.

Al añadir una métrica de cobertura, fija primero su configuración y umbrales en los paquetes que la midan, registra la salida de una ejecución completa y distingue entre código medido y código excluido. La cobertura ayuda a localizar rutas sin pruebas; no demuestra por sí sola que los controles estén bien especificados.
