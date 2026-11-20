# Prompt autónomo para el agente de Grumphya — Beta D

Implementa únicamente el lado Grumphya de este contrato. No necesitas leer
otro repositorio: todo lo necesario está incluido aquí. El lector compatible de
Desarrollo Seguro está publicado en `fix/audit-jwt-subject`, commit `8fc83b2`
(`feat: support composite private audit signals`).

## Límites inmutables

- Conserva exactamente las siete rutas `GET` existentes:
  `/audit/infrastructure`, `/audit/deployment`, `/audit/dependencies`,
  `/audit/auth`, `/audit/quality`, `/audit/privacy` y `/audit/ai`.
- No añadas rutas `application` ni `ethics`; esos nombres son scopes/criterios,
  no endpoints. No añadas `POST`, `PUT`, `PATCH` ni ingesta externa.
- No cambies `certifiedReportId`, la puntuación pública ni la certificación
  pública. Mantén `AUDIT_ENABLED` como esté en la configuración viva; no lo
  actives ni desactives como parte de este cambio.
- Las respuestas solo contienen estados, códigos, contadores, límites,
  digests, hashes y timestamps. No contienen HTML, cookies crudas, nombres de
  proveedores, dominios de terceros, cabeceras completas, IP internas,
  topología, rutas privadas, usuarios, secretos, prompts, modelos ni texto
  libre.

## Envoltura de respuesta y firma

Cada ruta devuelve JSON con exactamente estas claves en la envoltura:

```json
{
  "schemaVersion": "beta-d-0.2",
  "observedAt": "2026-11-20T08:00:00.000Z",
  "validUntil": "2026-11-20T08:30:00.000Z",
  "environment": "production",
  "deploymentDigest": "sha256:<64 hex>",
  "cardinality": 1,
  "evidence": { "observedAt": "...", "sampleRef": "sha256:<64 hex>", "signals": [] },
  "attestation": { "alg": "EdDSA", "kid": "<release-kid>", "signature": "<base64url>" }
}
```

`environment` es exactamente `production`, `cardinality` es exactamente `1`,
la ventana máxima es 24 horas y la firma EdDSA cubre la serialización
canónica de todos los campos salvo `attestation`. La privada solo vive en
`AUDIT_RELEASE_SIGNING_KEY`; el mismo `deploymentDigest` debe identificar el
artefacto que sirve producción. Si no se puede medir, vincular y firmar una
señal, su estado es `unknown`; no uses fixtures como `pass`.

## Evidencia compuesta exacta

`evidence` debe ser exactamente un objeto con `observedAt`, `sampleRef` y
`signals`. `sampleRef` es `sha256:` seguido de 64 caracteres hexadecimales.
Cada señal tiene exactamente `criterionId`, `status`, `reasonCode`, `value` y
`unit`; puede añadir `limit` (es obligatorio para `count` y `milliseconds`).

```json
{
  "observedAt": "2026-11-20T08:00:00.000Z",
  "sampleRef": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "signals": [
    {
      "criterionId": "infrastructure.headers",
      "status": "pass",
      "reasonCode": "security_headers_verified",
      "value": 1,
      "unit": "boolean"
    }
  ]
}
```

Estados permitidos: `pass`, `fail`, `unknown`, `not_applicable`. Unidades:
`boolean`, `count`, `milliseconds`. Los booleanos valen `0` o `1` y pueden
omitir `limit`; los contadores son enteros `0..1000` y las duraciones enteras
`0..120000`, ambas con `limit` de la misma unidad y dentro del rango. No se
aceptan claves adicionales, criterios duplicados, criterios de otra ruta,
valores fuera de rango ni códigos fuera de esta lista:

| Criterio | `reasonCode` permitido |
| --- | --- |
| `infrastructure.tls` | `infrastructure_transport_verified`, `infrastructure_transport_incomplete`, `infrastructure_transport_not_applicable` |
| `infrastructure.headers` | `security_headers_verified`, `security_headers_missing`, `security_headers_unobserved` |
| `infrastructure.network` | `network_surface_allowlisted`, `network_surface_restricted`, `network_surface_unobserved` |
| `application.secrets` | `secrets_not_in_image`, `secrets_check_unavailable` |
| `application.dependencies` | `dependency_risk_not_observed`, `high_dependency_risk_observed`, `critical_dependency_risk_observed` |
| `authentication.authorization` | `technical_contract_verified`, `technical_contract_mismatch`, `authorization_flow_passed`, `authorization_flow_failed` |
| `quality.e2e` | `public_flow_loaded`, `report_flow_loaded`, `release_checks` |
| `quality.accessibility` | `accessibility_critical_violations` |
| `performance.page_load` | `response_time`, `first_contentful_paint`, `interaction_to_next_paint` |
| `privacy.cookies` | `nonessential_storage_before_consent`, `essential_storage_only_before_consent`, `raw_identifier_storage_observed` |
| `privacy.third_parties` | `third_party_request_count`, `known_tracker_request_count`, `external_ingest_enabled` |
| `privacy.consent` | `consent_choice_recorded`, `consent_state_respected` |
| `ethics.transparency` | `privacy_notice_present`, `privacy_notice_missing`, `privacy_notice_unobserved` |
| `ai.disclosure` | `ai_disclosure_present`, `ai_disclosure_missing`, `ai_disclosure_unobserved` |

## Matriz ruta → criterios

Una ruta solo puede emitir los criterios de su fila. Una señal ausente queda
`unknown` en Desarrollo Seguro.

| Ruta | Criterios permitidos | Medición resumida |
| --- | --- | --- |
| `infrastructure` | `infrastructure.tls`, `infrastructure.headers`, `infrastructure.network` | Transporte TLS, cabeceras efectivas y superficie de red agregada; sin nombres, IP ni topología |
| `deployment` | `application.secrets` | Atestación del artefacto y `secrets_not_in_image`; digest servido |
| `dependencies` | `application.dependencies` | Recuentos agregados por severidad y digest; nunca SBOM ni paquetes |
| `auth` | `authentication.authorization` | Flujos sintéticos y resultado categórico; solo hash de referencia |
| `quality` | `quality.e2e`, `quality.accessibility`, `performance.page_load` | Métricas acotadas con valor, unidad, límite, hash y timestamp |
| `privacy` | `privacy.cookies`, `privacy.third_parties`, `privacy.consent`, `ethics.transparency` | Almacenamiento, terceros, consentimiento y presencia del aviso; sin nombres ni scripts |
| `ai` | `ai.disclosure` | Divulgación y revisión de IA; sin prompt, modelo, proveedor ni contenido |

No emitas `application.dependencies` desde `deployment` si ya lo aporta
`dependencies`. No emitas `ai.disclosure` desde `privacy`; la transparencia
ética sí viaja por `privacy` y requiere autorización de `ethics` además de
`privacy`.

## Identidad, red y persistencia

Valida el JWT técnico antes de leer: `iss=desarrolloseguro-audit`,
`aud=grumphya-audit`, `domain=grumphya.com`, `hostname=grumphya.com`,
`environment=production`, `kid` allowlisted, scopes `audit:<recurso>`,
expiración máxima de 5 minutos, tolerancia de reloj máxima de 60 segundos y
revocación. La clave privada de Desarrollo Seguro nunca se copia a Grumphya.

Mantén la base de Grumphya separada. La API de lectura usa solo `SELECT`; la
retención usa un rol independiente con `DELETE` limitado a evidencias y
atestaciones, o documenta y prueba explícitamente esos dos `DELETE` si se
mantiene dentro de la API. El escritor interno usa TLS y permisos mínimos. No
reutilices las rutas de lectura para insertar evidencias ni abras una red
Docker compartida o `0.0.0.0/0`.

## Pruebas y entrega

Añade pruebas de cada fila de la matriz: claves extra, sample hash, duplicados,
criterios cruzados, estados, códigos, unidades, límites, `unknown`, cardinalidad
y firma. Añade contrato de las siete rutas, permisos SQL y preflight que impida
activar la auditoría con configuración incompleta. Ejecuta lint, typecheck,
tests, build y pruebas locales PostgreSQL. No despliegues ni actives nada hasta
que las pruebas confirmen que el lector `8fc83b2` acepta exactamente este
esquema. Devuelve el commit, las pruebas y cualquier dato operativo pendiente.
