# Permisos de progreso público de auditoría

## Alcance

La API pública debe poder mostrar el progreso por aspecto mientras una auditoría
está en curso. La API lee `ds_scan_jobs.progress_json` usando el rol acotado
`ds_read`; la provisión de producción debe conceder el mismo permiso de lectura
por columna que la provisión normal.

## Límites

- Conceder únicamente `SELECT` sobre `progress_json` a `ds_read`.
- Mantener denegado el acceso de lectura de `lease_token` y columnas de datos
  internos que no formen parte de la proyección pública.
- Mantener intactos los permisos de escritura de API, worker y retención.
- Mantener alineadas las listas de permisos de producción y de provisión local.

## Criterios de aceptación

1. La provisión de producción concede a `ds_read` `SELECT` por columna sobre
   `progress_json` después de aplicar las migraciones.
2. `ds_api` puede leer `progress_json` mediante su membresía heredada en
   `ds_read`; no puede leer `lease_token` ni escribir trabajos.
3. La prueba PostgreSQL de provisión valida esos permisos y falla si producción
   omite una columna usada por el endpoint público.
4. El smoke posterior al despliegue puede consultar el estado público de
   `grumphya.com` y completar una auditoría sin respuesta HTTP 503 por permisos.
