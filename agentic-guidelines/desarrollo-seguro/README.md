# Desarrollo Seguro: alcance y estado

Desarrollo Seguro es una aplicación independiente en desarrollo para observar controles técnicos visibles en sitios web y mostrar evidencia acotada. Sus paquetes, API, base de datos y contenedores son propios; no comparte credenciales, tablas, servicios ni volúmenes con otras aplicaciones. Un proxy externo publica el portal en su dominio.

## Estado actual

- La API ofrece lecturas públicas de estado/informes y un `POST` explícito para solicitar análisis. Las rutas aplican límites antiabuso por proceso y `Cache-Control: no-store`; el POST exige confirmar autorización y aplica capacidad de cola compartida en PostgreSQL.
- El portal React permite buscar un dominio y pedir una admisión `on_demand`. Mientras haya trabajo activo consulta su estado; si la solicitud falla o no produce un informe nuevo, detiene el polling y muestra el fallo sin sustituirlo por un informe histórico.
- La persistencia PostgreSQL, las migraciones, los permisos de roles y la proyección pública están implementados. El stack de Compose crea una base y un volumen propios.
- El paquete worker contiene el proceso arrancable con rol `ds_worker`, recuperación periódica de leases, telemetría filtrada y cliente por socket Unix. Compose incorpora el worker y un coordinador aislado sin red que es el único proceso con socket Docker. Los trabajos usan un executor con `network none` y un broker en la red exclusiva de egress. El flujo manual de GitHub Actions despliega solo Desarrollo Seguro y, después, exige un informe real de `grumphya.com` con evidencia `domain-v3`; la operación en VPS aún requiere completar y revisar ese flujo.

El stack Compose conecta el portal a la red de entrada dedicada; API y PostgreSQL no exponen puertos al host. Usa redes, servicios, secretos y volumen propios. El scheduler de retención permanece fuera de Compose.

## Límites de las afirmaciones

Un estado `pass` describe los controles observados por el perfil indicado; no certifica el sitio, su seguridad global, cumplimiento legal ni ausencia de vulnerabilidades. `same_vps` identifica el punto de observación y no representa una verificación independiente desde otra red.

El código del escáner admite observaciones reales en el broker aislado. Las pruebas locales cubren resolución y fijación por conexión, redirecciones, límites de transporte, canal sin credenciales y persistencia en PostgreSQL temporal con fixtures. En desarrollo, las migraciones `012` y `013` desactivan el intervalo de 24 horas y la reutilización de informes durante 60 minutos; se mantienen límites antiabuso por minuto, una ejecución simultánea y hasta diez trabajos en espera. La calidad del runtime real en VPS solo se considera comprobada cuando el smoke posterior al deploy genera y valida un informe nuevo de `grumphya.com`.

## Guías

- [`features.md`](features.md): capacidades y criterios de aceptación.
- [`controls-and-evidence.md`](controls-and-evidence.md): rúbricas, evidencia y límites.
- [`scanner-safety.md`](scanner-safety.md): SSRF, solicitudes permitidas y aislamiento de red.
- [`persistence.md`](persistence.md): roles, migraciones y lectura pública.
- [`operations.md`](operations.md): Compose, secretos y operación.
- [`test-plan.md`](test-plan.md): cobertura de pruebas y gates pendientes.
