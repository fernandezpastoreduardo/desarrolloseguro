# Desarrollo Seguro: alcance y estado

Desarrollo Seguro es una aplicación independiente en desarrollo para observar controles técnicos visibles en sitios web y mostrar evidencia acotada. Sus paquetes, API, base de datos y contenedores son propios; no comparte credenciales, tablas, servicios ni volúmenes con otras aplicaciones. Un proxy externo publica el portal en su dominio.

## Estado actual

- La API ofrece lecturas públicas de estado/informes y un `POST` explícito para solicitar análisis. Las rutas aplican límites por proceso y `Cache-Control: no-store`; el POST exige confirmar autorización y aplica cuotas compartidas de PostgreSQL.
- El portal React permite buscar un dominio y pedir una admisión `on_demand` si no hay informe. Informa que la solicitud quedó en cola; no afirma que haya empezado el análisis.
- La persistencia PostgreSQL, las migraciones, los permisos de roles y la proyección pública están implementados. El stack de Compose crea una base y un volumen propios.
- El paquete worker contiene un proceso arrancable (`pnpm --filter @desarrolloseguro/worker start`) que compone PostgreSQL con rol `ds_worker`, el procesador de leases, recuperación periódica de leases vencidos, telemetría filtrada y el cliente del supervisor por socket Unix. Un proceso separado programa el purgado diario de informes con más de 90 días mediante el rol `ds_retention`. Ambos requieren secretos por fichero y permanecen fuera de Compose; no hay supervisor con egress habilitado, así que la admisión pública solo deja trabajos en cola.

El stack Compose publica el portal en `127.0.0.1:18080`; API y PostgreSQL no exponen puertos al host. Usa una red y un volumen propios. El despliegue no incluye worker ni scheduler.

## Límites de las afirmaciones

Un estado `pass` describe los controles observados por el perfil indicado; no certifica el sitio, su seguridad global, cumplimiento legal ni ausencia de vulnerabilidades. `same_vps` identifica el punto de observación y no representa una verificación independiente desde otra red.

El escaneo real queda deshabilitado. Las pruebas locales cubren resolución y fijación por conexión, redirecciones, límites de transporte, canal sin credenciales y persistencia en PostgreSQL temporal con fixtures. El runner Docker usa `network none`; antes de conectar un runtime con egress hacen falta reglas efectivas de salida IPv4/IPv6, pruebas contra destinos privados y señuelo, límites globales de carga, medición de capacidad y revisión del informe. Las pruebas no exploran dominios públicos.

## Guías

- [`features.md`](features.md): capacidades y criterios de aceptación.
- [`controls-and-evidence.md`](controls-and-evidence.md): rúbricas, evidencia y límites.
- [`scanner-safety.md`](scanner-safety.md): SSRF, solicitudes permitidas y aislamiento de red.
- [`persistence.md`](persistence.md): roles, migraciones y lectura pública.
- [`operations.md`](operations.md): Compose, secretos y operación.
- [`test-plan.md`](test-plan.md): cobertura de pruebas y gates pendientes.
