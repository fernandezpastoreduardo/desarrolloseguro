# Cierre de la Beta 0.1

Este documento fija el estado de la última entrega anterior a la definición del
MVP. No autoriza despliegues ni sustituye la validación operativa del VPS.

## Estado por etapa

| Etapa | Estado | Evidencia local | Pendiente explícito |
| --- | --- | --- | --- |
| A · lectura y evaluación pública | Implementada en código | Perfiles `domain-v1`/`domain-v2`/`domain-v3`, proyección pública allowlisted, resumen ético, sello verificable y UUID de informe | Ejecutar el runtime aislado en VPS con egress y un informe real de Grumphya |
| B · historial y comparabilidad | Implementada | `GET /history`, UUIDs, perfiles comparables, purga pública a 30 días, caché a 60 minutos y ventana de admisión a 24 horas | La interfaz usa estado consultable; no se añade SSE hasta tener una necesidad de producto y una prueba de contrato |
| C · auditoría periódica | Implementada localmente | Migración 026, scheduler horario, prioridad `requested` sobre `scheduled`, un slot global, recuperación de leases y eventos de transición | Operar el scheduler en VPS, medir recuperación y conectar un canal de notificación autorizado |
| D · auditoría privada de Grumphya | Preparada como dependencia | El sello público solo apunta al informe público certificado; no se añaden credenciales ni cambios al repositorio de Grumphya | Requiere autorización y contrato de lectura privada, alcance, retención y adaptador aislado antes de implementar controles privados |

## Puertas ejecutadas

En el árbol `main` se han ejecutado correctamente:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm build`
- `pnpm migrations:check`
- `pnpm test` fuera del sandbox para permitir los tests HTTP locales

La suite ejecutada reúne 713 pruebas de los paquetes core, web, persistence,
API y worker. Las pruebas PostgreSQL opt-in se omiten cuando no existe una base
aislada configurada; deben ejecutarse en CI o con `DS_TEST_POSTGRES_ISOLATED=1`
y una base local dedicada. Los diagnósticos Docker esperables de los dobles de
worker no se consideran fallos de la suite.

## Contratos de seguridad y privacidad

- El scanner público solo observa el perfil y las rutas declaradas, sin
  credenciales, formularios, POST, autenticación ni exploración arbitraria.
- El informe expone contadores, booleanos, estados y resúmenes allowlisted; no
  expone HTML, cabeceras completas, valores de cookies, IPs ni errores crudos.
- La caché y las ventanas de admisión se aplican en PostgreSQL, no en el
  navegador.
- Las auditorías certificadas se encolan con el rol aislado `ds_retention` y
  los trabajos manuales tienen prioridad al reclamar el único slot global.
- No se modifica el repositorio, dominio, CI ni correo de Grumphya.

## Criterio para detener la Beta

La Beta queda lista para revisión humana cuando se hayan aportado las dos
pruebas operativas que no pueden reproducirse aquí: un informe público real de
`grumphya.com` desde el runtime aislado y una ejecución controlada del scheduler
horario. La definición del MVP queda fuera de este cierre.
