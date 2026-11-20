# Prompt para el agente de Grumphya: señales privadas Beta D

Implementa la ampliación de evidencias privadas de Beta D contra el contrato
publicado por Desarrollo Seguro en
[`beta-stage-d-grumphya-handoff.md`](beta-stage-d-grumphya-handoff.md). Ese
documento es la fuente contractual autoritativa; no inventes rutas, criterios o
campos fuera de su matriz.

## Contrato que debes respetar

- Conserva las siete rutas `GET` existentes y la envoltura `beta-d-0.2`.
- No añadas ingesta externa ni métodos `POST`, `PUT` o `PATCH`.
- No crees rutas `application` ni `ethics`: `application.*` viaja por
  `deployment`/`dependencies` y `ethics.transparency` por `privacy`.
- En `evidence`, acepta exactamente `{observedAt, sampleRef, signals}` para
  reunir señales de una ruta. `sampleRef` es `sha256:` más 64 hexadecimales.
- Cada señal tiene `criterionId`, `status`, `reasonCode`, `value`, `unit` y,
  para `count` o `milliseconds`, `limit`. Los estados, códigos, unidades,
  límites y criterios válidos son los de la matriz publicada.
- Rechaza criterios de otra ruta, duplicados, texto libre, valores fuera de
  rango y señales sin `unknown` cuando la comprobación no sea observable.
- Conserva `cardinality=1`, firma EdDSA, `kid` de release y el mismo
  `deploymentDigest` servido. La clave privada sigue únicamente en
  `AUDIT_RELEASE_SIGNING_KEY`.

## Evidencia y seguridad

Genera las señales post-despliegue dentro de Grumphya, con el escritor interno
ya autorizado y TLS. No incluyas nombres de cookies, dominios de terceros,
cabeceras completas, IP internas, topología, HTML, prompts, modelos, secretos,
usuarios ni texto libre. Si una señal no puede medirse y firmarse contra el
digest desplegado, devuelve `unknown`; nunca uses fixtures como `pass`.

Mantén la API de lectura con mínimos permisos y la retención en su rol
independiente. `AUDIT_ENABLED` se mantiene con el valor de la configuración
viva hasta que ambas partes hayan probado el flujo; no lo cambies desde este
trabajo. No toques Desarrollo Seguro, su VPS, sus secretos, su base de datos,
su puntuación pública ni `certifiedReportId`.

## Validación y entrega

Añade pruebas unitarias de cada criterio, límites, duplicados, `unknown`, firma
y cardinalidad; pruebas de contrato de las siete rutas; y el preflight que
impida activar la auditoría con configuración incompleta. Ejecuta lint,
typecheck, tests, build y las pruebas de permisos PostgreSQL locales. No
despliegues ni actives una release hasta confirmar que el lector de Desarrollo
Seguro de la rama `fix/audit-jwt-subject` (commit que incorpora el parser de
señales compuestas) acepta exactamente este esquema. Publica primero los
cambios de contrato y reporta el commit, las pruebas y cualquier dato operativo
pendiente.
