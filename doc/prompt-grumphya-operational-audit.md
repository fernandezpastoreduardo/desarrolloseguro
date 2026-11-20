# Encargo operativo para Grumphya — auditoría privada Beta D

Implementa únicamente el lado Grumphya del contrato descrito en
[`grumphya-beta-d-signal-prompt.md`](grumphya-beta-d-signal-prompt.md) y en
[`beta-stage-d-grumphya-handoff.md`](beta-stage-d-grumphya-handoff.md). Esos
documentos son la fuente de verdad y no dependen de un commit de otro
repositorio.

## Decisiones que no se pueden cambiar

- Conserva exactamente las siete rutas `GET`: `infrastructure`, `deployment`,
  `dependencies`, `auth`, `quality`, `privacy` y `ai`.
- No añadas rutas `application` o `ethics`, métodos de escritura ni ingesta
  externa. Las rutas de lectura no reciben evidencias de Desarrollo Seguro.
- `/audit/privacy` puede transportar `ethics.transparency`; el scope externo
  es únicamente `audit:privacy`. No existe `audit:ethics`.
- Mantén la envoltura `beta-d-0.2`, `cardinality=1`, `environment=production`,
  `deploymentDigest` y la atestación EdDSA. La respuesta debe usar exactamente
  las claves especificadas en el contrato.
- `sampleRef` es el SHA-256 de la lista canónica UTF-8 de `signals` y debe
  verificarse antes de aceptar la evidencia. `unknown` y `not_applicable` usan
  `value: null` con `unit` obligatoria.
- El JWT exige `iss=desarrolloseguro-audit`, `sub=desarrolloseguro-audit`,
  `aud=grumphya-audit`, `domain=grumphya.com`, `hostname=grumphya.com`,
  `environment=production`, `kid` allowlisted y scopes `audit:<recurso>`.
  TTL máximo: cinco minutos; tolerancia de reloj: 60 segundos.
- Mantén `AUDIT_ENABLED` como esté en la configuración viva. No lo actives ni
  lo desactives por este cambio.

## Configuración y persistencia

Configura sin registrar valores:

- `AUDIT_TECHNICAL_AUTH_PUBLIC_KEY` y `AUDIT_TECHNICAL_AUTH_ALLOWED_KIDS`.
- `AUDIT_ALLOWED_NETWORKS` con la IP/CIDR que observe el proxy real; nunca una
  red Docker compartida ni una red abierta.
- `AUDIT_RELEASE_MANIFEST_PUBLIC_KEY` y sus `kid` allowlisted.
- `AUDIT_RELEASE_SIGNING_KEY` solo como secreto privado de GitHub Actions; no
  se copia al VPS ni a Desarrollo Seguro.

La API conserva `SELECT` únicamente. La retención usa un rol separado con
`DELETE` limitado a evidencias y atestaciones, y cualquier escritor interno
usa TLS y permisos mínimos. La base es exclusiva de Grumphya. No se modifican
certificaciones públicas, `certifiedReportId` ni puntuaciones externas.

## Validación y entrega

Añade pruebas de las siete rutas, claims JWT, ACL, TLS, firma, canonicalización,
`sampleRef`, cardinalidad, estados, límites, criterios cruzados y permisos SQL.
El preflight debe fallar cerrado con configuración incompleta. Ejecuta lint,
typecheck, tests, build y smoke autenticado local; no conviertas fixtures en
evidencia de producción.

Entrega un commit Conventional Commit, documentación operativa, matriz de
permisos y resultados de pruebas. No incluyas secretos, no actives auditoría ni
despliegues hasta que todas las pruebas del contrato pasen.
