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

Para el flujo TDD y el análisis estático privado con SonarQube local, consulta [Desarrollo guiado por pruebas](test-driven-development.md) y [SonarQube Community Build local](sonarqube-local.md).

## Evidencia temporal del consentimiento

El worker ejecuta contextos Chromium limpios e independientes para la carga inicial, aceptar y rechazar. Cada flujo conserva snapshots de cookies (nombres, dominio y atributos) y claves de almacenamiento antes de elegir, inmediatamente después de la acción y, en el flujo de rechazo, después de recargar. No conserva valores de cookies ni de almacenamiento.

La cronología de red separa la fase en que empezó cada solicitud de la fase en que recibió respuesta y terminó. Registra tiempos monotónicos para el clic de consentimiento y el inicio de la recarga, URL sin credenciales, query ni fragmento, host, método, tipo de recurso, estado HTTP, bloqueo efectuado por el auditor y nombres de cookies enviadas o recibidas; no registra cuerpos. Los segmentos de ruta que parecen identificadores se redactan. Se limita a 30 solicitudes por contexto y a 50 cookies/claves por snapshot; marca incompleta la evidencia correspondiente si alcanza un límite.

Esta captura es una fuente interna de evidencia para trabajo posterior. No modifica la puntuación ni la presentación del informe. Después de recargar, el worker cierra el permiso de escritura y abre el panel de preferencias sin guardar cambios. Solo lee interruptores de una vista identificada por «Preferencias/Configurar» o por un control «Guardar», nunca casillas genéricas de la página. `phaseEvidence.rejectionChoiceEvidence` registra los proveedores identificados, sus estados y el resultado: `rejected` solo cuando todos los controles visibles están identificados y desactivados; `not_rejected` si alguno sigue activado; `unknown` si la interfaz no permite una lectura completa. El campo legacy `rejectionPersistedAfterReload` sigue igual para conservar el informe vigente y no sirve como prueba jurídica; la mera desaparición del aviso no demuestra la persistencia del rechazo.

## Hallazgos LSSI separados

El worker calcula `legalCookieFindings` fuera de `privacyAssessment`. La primera regla detecta cookies identificadas por reglas técnicas de alta confianza en el flujo limpio antes de cualquier elección; la segunda detecta nombres de cookies atribuibles que se envían, reciben o permanecen en el inventario inmediatamente después del clic explícito en «Rechazar» y después de recargar. Los hallazgos incluyen fase, tiempo monotónico, nombre y dominio de la cookie, proveedor, regla de atribución, hosts correlacionados, artículos LSSI, órgano competente y máximo legal de 30.000 € para la infracción leve del artículo 38.4.g. No incluyen valores de cookie.

La matriz y el criterio de atribución están en [Auditoría jurídica de cookies](../agentic-guidelines/desarrollo-seguro/legal-cookie-audit.md). El campo se conserva en una tabla inmutable propia y se entrega como dato independiente en la respuesta del informe. No cambia puntuaciones, la respuesta de informes ya guardados, ni la presentación visual actual. Un resultado vacío significa que este slice no halló una cookie que cumpla sus reglas observacionales; no afirma cumplimiento general.

## Identidad visual pública

Las páginas informativas y el portal `/app/` comparten el logotipo SVG local,
los tokens Sass de color, tipografía y espaciado, y no cargan recursos de
terceros. El portal mantiene su modo oscuro y sus estados de análisis, pero su
encabezado enlaza con la misma navegación pública. Las transiciones se
desactivan cuando el navegador solicita movimiento reducido.

La configuración del proyecto fija Node/pnpm en `package.json`, `.nvmrc` y `pnpm-lock.yaml`. CI usa las mismas versiones.
