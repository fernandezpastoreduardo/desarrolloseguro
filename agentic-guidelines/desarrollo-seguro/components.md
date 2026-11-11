# Componentes y límites de paquete

La regla de alcance está en [AGENTS.md](../../AGENTS.md): el uso real determina si el código vive en una feature o en una pieza compartida. No se extrae código por una posible reutilización futura.

## Paquetes actuales

| Paquete | Responsabilidad |
| --- | --- |
| `apps/desarrollo-seguro/core` | Políticas puras, validación de evidencia y contratos necesarios para los consumidores DS. |
| `apps/desarrollo-seguro/persistence` | PostgreSQL, migraciones, roles, aprovisionamiento y lectura pública de informes. |
| `apps/desarrollo-seguro/api` | Endpoints NestJS de estado/informe, validación HTTP y rate limiting. |
| `apps/desarrollo-seguro/web` | Portal React de solo lectura y proxy de desarrollo. |
| `apps/desarrollo-seguro/worker` | Worker arrancable con rol PostgreSQL limitado, polling serial, telemetría filtrada y cliente Unix; incluye supervisor Docker independiente. Compose mantiene el worker en backend interno y el coordinador sin red. |

Los paquetes comparten contratos mediante dependencias workspace explícitas. No importan módulos de otros productos ni comparten estado mutable en memoria.

## Límites implementados

La API solo consulta snapshots e informes existentes. Un hostname sin datos devuelve `not_scanned`. Los informes públicos omiten `evidence_json`; las rutas devuelven `Cache-Control: no-store`. El limitador actual es por proceso y se reinicia con la API, por lo que no sustituye un store distribuido si se ejecutan varias instancias.

El portal consulta API bajo `/api/desarrollo-seguro/v1/`; en producción Nginx verifica TLS y hostname del upstream. Compose define servicios y PostgreSQL propios. Worker y coordinador están definidos como servicios aislados; el broker y executor se crean por trabajo desde imágenes locales. La red de egress y sus reglas se limitan a `br-ds-egress`. La operación real requiere verificar esas reglas en el VPS.

## Extensión

Antes de añadir una capacidad, identifica su feature, sus consumidores reales, contrato y datos que puede exponer. Mantén el transporte de red separado de las reglas de negocio y bloqueado hasta superar las puertas de [scanner-safety.md](scanner-safety.md). Actualiza pruebas y [test-plan.md](test-plan.md) junto con la implementación.
