# Contrato de integración D para Grumphya

Este documento es una solicitud de contrato para la etapa D. No concede
acceso, no contiene credenciales y no convierte fixtures en evidencia. Debe
implementarse y revisarse en el repositorio de Grumphya antes de ejecutar una
auditoría privada en producción. Desarrollo Seguro solo leerá las respuestas
allowlisted y conservará estados, códigos, contadores, digests y timestamps.

## Identidad y límites

- Emisor: identidad técnica `desarrollo-seguro-auditor`.
- Entorno: `production` y únicamente `https://grumphya.com`.
- Permiso: `GET` de solo lectura con un JWT técnico EdDSA de corta duración,
  sin acceso a base de datos, consola,
  archivos, variables, usuarios reales ni rutas arbitrarias.
- Transporte: HTTPS con validación de certificado; las redirecciones se
  rechazan.
- Respuesta: `application/json` con tamaño máximo acordado y la envolvente
  `beta-d-0.2`; HTML, texto libre,
  cabeceras completas, cookies y secretos hacen fallar la auditoría de forma
  segura.
- Retención: máximo 30 días para el informe privado y sus digests; revocación
  inmediata de la identidad y contacto operativo documentado.

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

El JWT técnico lo emite Desarrollo Seguro con `iss`, `sub`, `aud`, `iat`,
`exp`, `jti`, `kid`, `hostname`, `environment` y `scope`. Grumphya debe validar
firma, issuer, audience, `kid`, entorno, dominio, scopes, expiración y
revocación antes de leer cualquier evidencia. Nunca se comparte la clave
privada ni se acepta una cookie o un JWT de usuario para este canal.

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

Hasta que se cumplan estos puntos, el runner local de Desarrollo Seguro debe
seguir devolviendo `internal_audit_unavailable`/`invalid_evidence` y no crear
un informe privado de producción.
