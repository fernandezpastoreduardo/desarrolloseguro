# Integración continua

El workflow [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) verifica cambios en pull requests y en `main`. Usa Node 26.13 y pnpm 12.5.1, instala con lockfile congelado, ejecuta calidad y pruebas PostgreSQL contra un servicio efímero, construye la imagen de la API y realiza un smoke aislado. CI no despliega ni publica imágenes.

Comprobaciones locales:

```sh
pnpm install --frozen-lockfile
pnpm ci:verify
```

El paso PostgreSQL usa una base efímera del workflow. La auditoría de dependencias también forma parte del job. Los resultados de CI describen el commit probado; no acreditan un despliegue externo.
