# Contrato de integración D para Grumphya

Este documento es una solicitud de contrato para la etapa D. No concede
acceso, no contiene credenciales y no convierte fixtures en evidencia. Debe
implementarse y revisarse en el repositorio de Grumphya antes de ejecutar una
auditoría privada en producción. Desarrollo Seguro solo leerá las respuestas
allowlisted y conservará estados, códigos, contadores, digests y timestamps.

## Identidad y límites

- Emisor: identidad técnica `desarrolloseguro-audit`.
- Entorno: `production` y únicamente `https://grumphya.com`.
- Permiso: `GET` de solo lectura con un JWT técnico EdDSA de corta duración,
  sin acceso a base de datos, consola,
  archivos, variables, usuarios reales ni rutas arbitrarias.
- Transporte: HTTPS con validación de certificado; las redirecciones se
  rechazan.
- Respuesta: `application/json` de como máximo 64 KiB y con la envolvente
  `beta-d-0.2`; HTML, texto libre,
  cabeceras completas, cookies y secretos hacen fallar la auditoría de forma
  segura.
- Retención: máximo 30 días para el informe privado y sus digests; revocación
  inmediata de la identidad y contacto operativo documentado.

### Identidad DS preparada

La identidad técnica ya está generada en el VPS de Desarrollo Seguro, pero no
está activa para producción. El `kid` vigente es `ds-auditor-2026`. La clave
pública Ed25519 se entrega por el canal operativo seguro; su huella SHA-256
canónica sobre el DER SPKI es
`b4aea1fe81f85f13370708dbb38fc22e0815b4aaf59dc5c869d74394b2d27caa`.
La clave privada permanece en Desarrollo Seguro y nunca debe copiarse a
Grumphya. La ruta observada de salida del VPS es `31.70.130.181`; el valor
candidato para `AUDIT_ALLOWED_NETWORKS` es `31.70.130.181/32`, pendiente de
confirmación por el proxy de Grumphya.

## Catálogo mínimo de recursos

Grumphya debe publicar rutas estables y versionadas bajo un prefijo de
auditoría. El catálogo exacto puede variar, pero debe conservar estos datos
semánticos y no añadir contenido de usuario:

| Recurso | Datos permitidos |
| --- | --- |
| `infrastructure` | estado, versión del despliegue, transporte TLS, exposición y privilegios como códigos/booleanos |
| `deployment` | digest del artefacto, digest de dependencias y códigos de controles |
| `dependencies` | recuentos agregados por severidad y digest del inventario; nunca SBOM ni nombres de paquetes |
| `auth` | flujos sintéticos de login, frontera de autorización y logout; solo referencias hash |
| `quality` | métricas agregadas de E2E, rendimiento, accesibilidad y responsive con unidad, límite y timestamp |
| `privacy` | contadores booleanos de almacenamiento, terceros, consentimiento y transparencia |
| `ai` | estado de controles de transparencia, minimización, revisión humana y uso de IA |

Cada respuesta debe incluir exactamente `schemaVersion`, `observedAt`,
`validUntil`, `environment`, `deploymentDigest`, `cardinality`, `evidence` y
`attestation`. `environment` debe ser exactamente `production`; un valor
diferente se rechaza. En esta versión `schemaVersion` es `beta-d-0.2` y
`cardinality` es `1`. `attestation` contiene `alg: EdDSA`, un `kid` de release
allowlisted y una firma base64url sobre la serialización canónica del resto de
la envolvente. Desarrollo Seguro rechaza timestamps futuros, evidencia de más
de 24 horas, ventanas mayores de 24 horas, firmas inválidas y cardinalidades
distintas de una.

## Matriz aclaratoria para completar la cobertura D

La cobertura se reparte entre los siete recursos existentes. No se crean rutas
`application` ni `ethics`, y una lectura no puede proyectar dos veces el mismo
criterio. La siguiente es la matriz autoritativa para la ampliación; si una
señal no está disponible debe quedar `unknown` en Desarrollo Seguro.

| Recurso existente | Criterios que puede aportar | Fuente y observación permitida |
| --- | --- | --- |
| `infrastructure` | `infrastructure.tls`, `infrastructure.headers`, `infrastructure.network` | Snapshot del despliegue y señales agregadas de transporte, cabeceras efectivas y superficie de red; nunca nombres de cabeceras, IP internas, topología ni configuración completa |
| `deployment` | `application.secrets` | Atestación del artefacto desplegado y comprobación `secrets_not_in_image`; el digest debe corresponder al release servido |
| `dependencies` | `application.dependencies` | Contadores agregados por severidad y digest de inventario; no se repite desde `deployment` |
| `auth` | `authentication.authorization` | Flujos sintéticos de autorización; solo hash de referencia y resultado categórico |
| `quality` | `quality.e2e`, `quality.accessibility`, `performance.page_load` | Métricas allowlisted con valor, unidad, límite, hash de muestra y timestamp |
| `privacy` | `privacy.cookies`, `privacy.third_parties`, `privacy.consent`, `ethics.transparency` | Señales agregadas de almacenamiento, terceros, consentimiento y presencia de aviso; no nombres, dominios, scripts ni texto |
| `ai` | `ai.disclosure` | Estado booleano de divulgación y revisión de IA; sin prompt, modelo, proveedor ni contenido de usuario |

La envoltura conserva `beta-d-0.2` y `cardinality=1`. Para transportar más de
una señal dentro de una ruta, `evidence` puede usar esta forma allowlisted y
determinista (la lista no puede contener criterios fuera de la fila del recurso).
Es una ampliación coordinada del parser: Grumphya no debe publicarla hasta que
Desarrollo Seguro haya incorporado y probado el mismo esquema.

```json
{
  "observedAt": "2026-11-20T08:00:00.000Z",
  "sampleRef": "sha256:<64 hex>",
  "signals": [
    {
      "criterionId": "infrastructure.headers",
      "status": "pass",
      "reasonCode": "security_headers_verified",
      "value": 1,
      "unit": "boolean",
      "limit": 1
    }
  ]
}
```

`status` solo puede ser `pass`, `fail`, `unknown` o `not_applicable`.
`unit` solo puede ser `boolean`, `count` o `milliseconds`; los booleanos usan
`0/1` y pueden omitir `limit`; los contadores no superan `1000` y las
duraciones no superan `120000`, y ambos deben incluir un `limit` con la misma
unidad y dentro del mismo rango. `limit` es opcional para booleanos y, si se
incluye, debe valer `0/1`.
Los hashes usan `sha256:` seguido de 64 dígitos hexadecimales. Los códigos de
señal son allowlisted y deben seguir `^[a-z0-9]+(?:_[a-z0-9]+)*$`; no se
acepta texto libre. Desarrollo Seguro completa como `unknown` cualquier
criterio de la matriz que no llegue en la respuesta.

Los códigos mínimos para las señales nuevas son:

- `infrastructure.headers`: `security_headers_verified`,
  `security_headers_missing`, `security_headers_unobserved`.
- `infrastructure.network`: `network_surface_allowlisted`,
  `network_surface_restricted`, `network_surface_unobserved`.
- `ethics.transparency`: `privacy_notice_present`,
  `privacy_notice_missing`, `privacy_notice_unobserved`.
- `ai.disclosure`: `ai_disclosure_present`, `ai_disclosure_missing`,
  `ai_disclosure_unobserved`.

Los criterios ya cubiertos mantienen sus códigos actuales de los parsers D:
`dependency_risk_not_observed`, `high_dependency_risk_observed`,
`critical_dependency_risk_observed`, las métricas de calidad allowlisted y las
señales de privacidad de almacenamiento, terceros y consentimiento. Una
atestación de `deployment` no debe volver a emitir
`application.dependencies` si el recurso `dependencies` ya lo aporta.

Las comprobaciones posteriores al despliegue se generan en el flujo interno de
Grumphya, se firman con `AUDIT_RELEASE_SIGNING_KEY`, se asocian al mismo
`deploymentDigest` servido y se persisten mediante el escritor interno ya
autorizado. No se introduce ingesta externa ni se comparte la clave privada.
Si esa medición no puede firmarse y vincularse al digest, el criterio queda
`unknown`; no se reutiliza una fixture ni se fabrica un `pass`.

El valor autoritativo de `AUDIT_ENABLED` es la configuración viva del VPS y el
entorno del contenedor en ejecución, no un documento del repositorio. Esta
ampliación no cambia ese valor, no toca la certificación pública y no modifica
`certifiedReportId`.

El JWT técnico lo emite Desarrollo Seguro con `iss`, `sub`, `aud`, `iat`,
`exp`, `jti`, `kid`, `domain`, `hostname`, `environment` y `scope`. Grumphya debe validar
firma, issuer, audience, `kid`, entorno, dominio, scopes, expiración y
revocación antes de leer cualquier evidencia. Nunca se comparte la clave
privada ni se acepta una cookie o un JWT de usuario para este canal.
El `iss` debe ser exactamente `desarrolloseguro-audit`, `aud` exactamente
`grumphya-audit`, `domain` exactamente `grumphya.com` y cada valor de `scope`
usa el formato `audit:<recurso>`.

## Persistencia, retención y red

La API de Grumphya no debe recibir permisos de escritura de evidencias por
defecto. La opción recomendada es un rol de mantenimiento independiente para
la retención, con `DELETE` limitado a las tablas de evidencias y atestaciones;
la API conserva solo `SELECT`. Si el despliegue mantiene la retención dentro
de la API, el permiso adicional debe quedar limitado a esos dos `DELETE` y
probarse explícitamente antes de activar la auditoría. En ambos casos la base
de datos sigue siendo exclusiva de Grumphya y todas las conexiones usan TLS.

El escritor de evidencias debe exponerse mediante un canal autenticado y
allowlisted con TLS. Las rutas de lectura actuales no son un canal de
escritura y no se deben reutilizar para insertar evidencias. La ACL de red se
configura con la IP o CIDR que observe el proxy de Grumphya en la petición
real; nunca con una red Docker compartida ni con una red abierta.

## Cuentas y datos sintéticos

Si `auth` requiere sesión, Grumphya debe proporcionar una cuenta sintética
dedicada a la auditoría, con permisos mínimos y datos que no representen a
personas reales. Desarrollo Seguro no recibirá contraseñas persistentes en el
informe: el adaptador usará un secreto efímero gestionado por el entorno y
solo guardará un hash de referencia y el resultado categórico de cada flujo.

La prueba debe poder repetirse sin crear, borrar o modificar datos de cliente.
No se aceptan enumeración de usuarios, fuerza bruta, cargas de estrés ni
pruebas destructivas.

## Aceptación antes de activar D

1. Grumphya documenta la identidad, scopes, revocación, contacto y retención.
2. Un preflight autenticado con el JWT técnico confirma que las rutas devuelven
   JSON versionado y rechaza HTML o redirecciones; una petición sin identidad
   debe ser rechazada por Grumphya.
3. La cuenta sintética y sus datos se prueban en un entorno aislado.
4. El digest de despliegue y el de dependencias corresponden al artefacto que
   está sirviendo producción.
5. La auditoría devuelve un informe privado incompleto si faltan controles; no
   eleva por sí sola la certificación pública ni mezcla la puntuación interna
   con la externa.
6. Se conserva una evidencia categórica de revocación y de expiración de la
   retención.
7. La matriz de permisos confirma el rol de lectura de la API, el rol de
   mantenimiento o escritor y el canal TLS de ingesta; una API con solo
   `SELECT` no se considera suficiente si la retención sigue ejecutándose con
   esa misma conexión.

Hasta que se cumplan estos puntos, el runner local de Desarrollo Seguro debe
seguir devolviendo `internal_audit_unavailable`/`invalid_evidence` y no crear
un informe privado de producción.
