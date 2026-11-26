# Beta 0.1: alcance y estado

> Este documento y las especificaciones asociadas describen la implementación actual de la Beta. El cierre y las dependencias operativas están en [`../../doc/beta-closure.md`](../../doc/beta-closure.md). Sigue [`../../AGENTS.md`](../../AGENTS.md) y no definas el MVP dentro de esta entrega.

La evaluación específica de C, el plan incremental de D y el cierre global
están en [`../../doc/beta-stage-c-assessment.md`](../../doc/beta-stage-c-assessment.md),
[`../../doc/beta-stage-d-plan.md`](../../doc/beta-stage-d-plan.md) y
[`../../doc/beta-global-closure-plan.md`](../../doc/beta-global-closure-plan.md).

Desarrollo Seguro es una aplicación independiente en desarrollo para observar controles técnicos visibles en sitios web y mostrar evidencia acotada. Sus paquetes, API, base de datos y contenedores son propios; no comparte credenciales, tablas, servicios ni volúmenes con otras aplicaciones. Un proxy externo publica el portal en su dominio.

## Estado actual

- La API ofrece lecturas públicas de estado/informes y un `POST` explícito para solicitar análisis. Las rutas aplican límites antiabuso por proceso y `Cache-Control: no-store`; el POST exige confirmar autorización y aplica capacidad de cola compartida en PostgreSQL.
- El portal React permite buscar un dominio y pedir una admisión `on_demand`. Mientras haya trabajo activo consulta su estado; si la solicitud falla o no produce un informe nuevo, detiene el polling y muestra el fallo sin sustituirlo por un informe histórico.
- La persistencia PostgreSQL, las migraciones, los permisos de roles y la proyección pública están implementados. El stack de Compose crea una base y un volumen propios.
- El paquete worker contiene el proceso arrancable con rol `ds_worker`, recuperación periódica de leases, telemetría filtrada y cliente por socket Unix. Compose incorpora el worker y un coordinador aislado sin red que es el único proceso con socket Docker. Los trabajos usan un executor con `network none` y un broker en la red exclusiva de egress. El flujo manual de GitHub Actions despliega solo Desarrollo Seguro y, después, exige un informe real de `grumphya.com` con evidencia `domain-v4`; los despliegues controlados confirmaron salud, ciclo de schedulers y recuperación aislada. El 20 de noviembre de 2026 se observó además una renovación programada con informe nuevo, ficha actualizada, certificación activa y nueve leases expirados terminados tras tres intentos; queda como validación separada una incidencia notificable.

El stack Compose conecta el portal a la red de entrada dedicada; API y PostgreSQL no exponen puertos al host. Usa redes, servicios, secretos y volumen propios. Los schedulers de retención y certificación operan en Compose con el rol dedicado, sin puertos ni egress; el deploy deja evidencia acotada de su ciclo y recuperación.

## Límites de las afirmaciones

Un estado `pass` describe los controles observados por el perfil indicado; no certifica el sitio, su seguridad global, cumplimiento legal ni ausencia de vulnerabilidades. `same_vps` identifica el punto de observación y no representa una verificación independiente desde otra red.

El código del escáner admite observaciones reales en el broker aislado. Las pruebas locales cubren resolución y fijación por conexión, redirecciones, límites de transporte, canal sin credenciales y persistencia en PostgreSQL temporal con fixtures. Durante la Beta, las migraciones 029 y 030 mantienen desactivadas la ventana de 24 horas y la caché de 60 minutos; se conservan el límite antiabuso por minuto, una ejecución simultánea y hasta diez trabajos en espera. El smoke posterior al deploy valida un informe público real de `grumphya.com`; una renovación programada del 20 de noviembre de 2026 confirmó la transición de certificación y el puntero actualizado.

## Guías

- [`features.md`](features.md): capacidades y criterios de aceptación.
- [`ux-ui-copy-refresh.md`](ux-ui-copy-refresh.md): identidad visual, copy,
  portada, portal y páginas informativas para la revisión UX/UI actual.
- [`controls-and-evidence.md`](controls-and-evidence.md): rúbricas, evidencia y límites.
- [`scanner-safety.md`](scanner-safety.md): SSRF, solicitudes permitidas y aislamiento de red.
- [`persistence.md`](persistence.md): roles, migraciones y lectura pública.
- [`operations.md`](operations.md): Compose, secretos y operación.
- [`test-plan.md`](test-plan.md): cobertura de pruebas y gates pendientes.
