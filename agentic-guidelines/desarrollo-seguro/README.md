# Desarrollo Seguro: alcance y estado

Desarrollo Seguro es una aplicación independiente en desarrollo para observar controles técnicos visibles en sitios web y mostrar evidencia acotada. Sus paquetes, API, base de datos y contenedores son propios; no comparte credenciales, tablas, servicios ni volúmenes con otras aplicaciones. Un proxy externo publica el portal en su dominio.

## Estado actual

- La API ofrece lecturas públicas de estado e informes existentes. Ambas son `GET`, aplican límites por proceso, responden con `Cache-Control: no-store` y no inician trabajos.
- El portal React consulta esas rutas; si no hay un informe, muestra `not_scanned`. No inventa una evaluación.
- La persistencia PostgreSQL, las migraciones, los permisos de roles y la proyección pública están implementados. El stack de Compose crea una base y un volumen propios.
- El paquete worker contiene un procesador de leases y primitivas locales probadas para DNS público fijado y solicitudes HTTPS acotadas. `transport-v1` define un perfil reducido de cuatro controles y cinco comprobaciones; sus observaciones de fixture recorren la sanitización y las proyecciones de informe. No hay un executor de red arrancable ni escaneos reales.

El stack Compose publica el portal en `127.0.0.1:18080`; API y PostgreSQL no exponen puertos al host. Usa una red y un volumen propios. El despliegue no incluye worker, cola ni scheduler.

## Límites de las afirmaciones

Un estado `pass` describe los controles observados por el perfil indicado; no certifica el sitio, su seguridad global, cumplimiento legal ni ausencia de vulnerabilidades. `same_vps` identifica el punto de observación y no representa una verificación independiente desde otra red.

El escaneo queda deshabilitado hasta integrar y probar resolución y fijación de IP extremo a extremo, redirecciones, separación del executor respecto de las credenciales de persistencia, aislamiento de salida IPv4/IPv6, límites globales de carga, egress y capacidad. Las pruebas automatizadas usan fixtures y servidores locales; no exploran dominios públicos.

## Guías

- [`features.md`](features.md): capacidades y criterios de aceptación.
- [`controls-and-evidence.md`](controls-and-evidence.md): rúbricas, evidencia y límites.
- [`scanner-safety.md`](scanner-safety.md): SSRF, solicitudes permitidas y aislamiento de red.
- [`persistence.md`](persistence.md): roles, migraciones y lectura pública.
- [`operations.md`](operations.md): Compose, secretos y operación.
- [`test-plan.md`](test-plan.md): cobertura de pruebas y gates pendientes.
