# Desarrollo local

## Requisitos

- Node.js 26.13.1 (`.nvmrc`) y pnpm 12.5.1.
- Docker Engine/Desktop con Docker Compose.
- Para verificaciones PostgreSQL: instancia local y dedicada de PostgreSQL 19 con pgvector 0.8.7.

Instala dependencias y arranca la aplicación:

```sh
pnpm install
pnpm dev
```

Para ejecutar la pila contenerizada independiente, consulta [Producción](production.md). Compose publica únicamente el frontend en `127.0.0.1:18080` por defecto; base de datos y API no publican puertos del host.

## Calidad

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`pnpm test:postgres` requiere `DS_TEST_POSTGRES_ISOLATED=1` y `DS_TEST_DATABASE_URL` apuntando a un cluster local dedicado. El test puede crear y eliminar bases y roles; no lo dirijas a datos compartidos o de producción.

`scripts/run-development-security-public-audit-lab-01.sh` verifica migraciones y arranque de API con contenedores efímeros. `scripts/run-development-security-public-audit-lab-04.sh` ejercita el recorrido navegador → API → worker → runtime → PostgreSQL → informe con hostnames HTTPS sintéticos, sin interceptiones de API ni salida externa. Requiere las nueve imágenes de producción construidas localmente; acepta sus tags como argumentos en el orden documentado por el propio script. Cada ejecución usa recursos Docker con etiqueta propia, no publica puertos y los limpia al terminar. CI ejecuta ambos laboratorios antes de permitir deploy.

Las auditorías `domain-v5` conservan la ruta y la query elegidas, sin fragmento. El worker y el coordinador validan el resultado contra esa misma ruta exacta; un resultado de otra ruta se rechaza. El POST de análisis devuelve el UUID del job y el navegador lo conserva en memoria mientras consulta su estado. El polling usa solo `hostname + jobId`; los informes se leen por `ds_scan_runs.job_id`, sin asociar fallos ni resultados de otra ruta. El identificador no contiene la URL ni la huella de esta.

El mensaje técnico de error y el botón de reintento solo se muestran si ese job termina en un error técnico antes de publicar un informe. Un criterio legal incumplido, desconocido o incompleto forma parte del informe y no se convierte en ese error genérico. Tras recargar la página no se conserva un jobId terminal: se muestra el informe disponible y se puede iniciar una nueva revisión.

Para el flujo TDD y el análisis estático privado con SonarQube local, consulta [Desarrollo guiado por pruebas](test-driven-development.md) y [SonarQube Community Build local](sonarqube-local.md).

## Evidencia temporal del consentimiento

El worker ejecuta contextos Chromium limpios e independientes para la carga inicial, aceptar y rechazar. Cada flujo conserva snapshots de cookies (nombres, dominio y atributos) y claves de almacenamiento antes de elegir e inmediatamente después de la acción; aceptación y rechazo capturan también una instantánea tras recargar. La respuesta pública expone por separado cantidad total, cantidad coincidente con el catálogo y hasta tres ejemplos de cookies coincidentes por etapa. No conserva valores de cookies ni de almacenamiento.

La cronología de red separa la fase en que empezó cada solicitud de la fase en que recibió respuesta y terminó. Registra tiempos monotónicos para el clic de consentimiento y el inicio de la recarga, URL sin credenciales, query ni fragmento, host, método, tipo de recurso, estado HTTP, bloqueo efectuado por el auditor y nombres de cookies enviadas o recibidas; no registra cuerpos. Los segmentos de ruta que parecen identificadores se redactan. Se limita a 30 solicitudes por contexto y a 50 cookies/claves por snapshot; marca incompleta la evidencia correspondiente si alcanza un límite.

La evaluación pública muestra recuentos y el estado de cada fase. Una cookie solo se atribuye a un servicio cuando la regla versionada exige y recibe la corroboración indicada; el catálogo incluye finalidad, categoría y fuente oficial. Las señales Clarity y Fullstory pueden clasificarse como mapas de calor, pero por sí solas no acreditan venta o reutilización de datos. Después de recargar el flujo de rechazo, el worker cierra el permiso de escritura y abre el panel de preferencias sin guardar cambios. Solo lee interruptores de una vista identificada por «Preferencias/Configurar» o por un control «Guardar», nunca casillas genéricas de la página. `phaseEvidence.rejectionChoiceEvidence` registra los proveedores identificados, sus estados y el resultado: `rejected` solo cuando todos los controles visibles están identificados y desactivados; `not_rejected` si alguno sigue activado; `unknown` si la interfaz no permite una lectura completa. El campo legacy `rejectionPersistedAfterReload` sigue igual para conservar el informe vigente y no sirve como prueba jurídica; la mera desaparición del aviso no demuestra la persistencia del rechazo.

## Redirecciones HTTP/HTTPS

Las sondas siguen redirects solo entre el hostname enviado a auditoría y su alias literal con prefijo `www.`. Aplican los mismos límites de ruta, puerto, DNS, TLS y egress a cualquier dominio. La evidencia de canonicalización permanente 301/308 se genera y expone de forma genérica; la identidad y el historial de informes siguen siendo independientes por hostname, salvo la regla propia de Grumphya.

## Hallazgos LSSI separados

El worker calcula `legalCookieFindings` fuera de `privacyAssessment`. La primera regla detecta cookies identificadas por reglas técnicas de alta confianza en el flujo limpio antes de cualquier elección; la segunda detecta nombres de cookies atribuibles que se envían, reciben o permanecen en el inventario inmediatamente después del clic explícito en «Rechazar» y después de recargar. Los hallazgos incluyen fase, tiempo monotónico, nombre y dominio de la cookie, proveedor, regla de atribución, hosts correlacionados, artículos LSSI, órgano competente y máximo legal de 30.000 € para la infracción leve del artículo 38.4.g. No incluyen valores de cookie. La tarjeta Legalidad presenta estos hallazgos aunque otro control técnico no haya podido completarse.

La matriz y el criterio de atribución están en [Auditoría jurídica de cookies](../agentic-guidelines/desarrollo-seguro/legal-cookie-audit.md). El campo se conserva en una tabla inmutable propia y se entrega como dato independiente en la respuesta del informe. No cambia puntuaciones, la respuesta de informes ya guardados, ni la presentación visual actual. Un resultado vacío significa que este slice no halló una cookie que cumpla sus reglas observacionales; no afirma cumplimiento general.

## Identidad visual pública

Las páginas informativas y el portal `/app/` comparten el logotipo SVG local,
los tokens Sass de color, tipografía y espaciado, y no cargan recursos de
terceros. El portal mantiene su modo oscuro y sus estados de análisis, pero su
encabezado enlaza con la misma navegación pública. Las transiciones se
desactivan cuando el navegador solicita movimiento reducido.

La configuración del proyecto fija Node/pnpm en `package.json`, `.nvmrc` y `pnpm-lock.yaml`. CI usa las mismas versiones.
