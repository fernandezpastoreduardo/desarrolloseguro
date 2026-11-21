# Credenciales y secretos

El Compose propio lee sus secretos desde `.secrets/` (o desde `DEVELOPMENT_SECURITY_SECRETS_DIR`). Deben existir los archivos definidos al final de [`compose.production.yaml`](../compose.production.yaml): credenciales de administrador/migrador/API/worker/retención, TLS de PostgreSQL y API, y la CA interna. `development_security_worker_database_url` es el login separado `ds_worker`; `development_security_retention_database_url` es el login `ds_retention`, que solo puede ejecutar los purgados sujetos a sus ventanas y encolar auditorías de certificaciones activas.

La auditoría privada D permanece desactivada (`AUDIT_ENABLED=false`) hasta
completar el contrato externo con Grumphya. Cuando se autorice su activación,
el runtime de Desarrollo Seguro necesita `AUDIT_JWT_PRIVATE_KEY_FILE`,
`AUDIT_JWT_ISSUER`, `AUDIT_JWT_AUDIENCE`, `AUDIT_TECHNICAL_AUTH_KID`,
`AUDIT_RELEASE_ATTESTATION_PUBLIC_KEY_FILE`, `AUDIT_RELEASE_ATTESTATION_KID`,
`AUDIT_ALLOWED_NETWORKS` y
`AUDIT_TECHNICAL_AUTH_ALLOWED_KIDS`. Las dos claves se guardan en ficheros
separados con permisos de propietario; la privada JWT nunca sale de Desarrollo
Seguro y la privada de firma de releases solo vive en Actions de Grumphya. El
preflight `pnpm audit:preflight` falla si la auditoría está activada sin todos
los valores, si una red es abierta o si un `kid` no está en la lista activa.
El preflight también valida que la clave JWT privada y la clave pública de
atestación sean PEM Ed25519 utilizables y que issuer/audience conserven
exactamente el contrato `desarrolloseguro-audit`/`grumphya-audit`; un archivo
arbitrario o una clave de otra familia falla antes de arrancar el runtime.
El contrato externo fija `AUDIT_JWT_ISSUER=desarrolloseguro-audit` y
`AUDIT_JWT_AUDIENCE=grumphya-audit`; el token añade `domain=grumphya.com` y
scopes con el formato `audit:<recurso>`.
La activación también depende de que Grumphya haya probado el canal TLS de
escritura y la separación de roles de lectura y retención; esas garantías no
se pueden inferir desde el contenedor de Desarrollo Seguro.

Usa valores únicos y aleatorios para cada entorno, limita permisos de lectura y conserva la clave privada de la CA fuera del servidor de aplicación. No guardes secretos en Git, logs, imágenes Docker ni documentación. `.gitignore` excluye `.secrets/`. El worker y los schedulers de retención y certificación usan sus URL en ficheros separados y exigen una CA verificada en producción. El rol de retención solo ejecuta los purgados protegidos de 90 días, de inactividad pública de 30 días y el encolado horario de certificaciones activas; ambos schedulers operan en Compose sin egress ni puertos y sus procesos se reinician de forma aislada durante la verificación de deploy.

El repositorio no genera ni almacena estos secretos, no incluye un gestor de secretos y no configura credenciales de otra aplicación. Rota credenciales y certificados según el procedimiento operativo del entorno.

## Preparar la identidad de Desarrollo Seguro

Cuando Grumphya confirme que puede recibir la identidad técnica, un operador
con acceso root puede ejecutar `pnpm audit:identity:provision` en el VPS. El
comando crea una clave Ed25519 privada en
`/opt/desarrollo-seguro/secrets/audit_jwt_private.pem` (`0400`, solo `root`) y
su clave pública en `audit_jwt_public.pem` (`0400`). Es idempotente por
diseño: si cualquiera de los dos ficheros ya existe, falla y no sobrescribe
una identidad que pueda seguir activa. La salida solo contiene el `kid`, la
ruta pública, su huella SHA-256 y `enabled=false`; nunca muestra la privada ni
activa el worker.

Entrega a Grumphya únicamente el PEM público y comprueba la huella por un
canal independiente. El `kid` por defecto es `ds-auditor-2026` y puede
cambiarse al generar una identidad nueva con
`AUDIT_TECHNICAL_AUTH_KID`, siempre que coincida con la lista de rotación de
Grumphya. La observación de solo lectura del VPS del 19 de noviembre de 2026
mostró `31.70.130.181` como IP pública de salida
(`src=31.70.130.181`). Por tanto, el valor candidato para
`AUDIT_ALLOWED_NETWORKS` es `31.70.130.181/32`; Grumphya debe confirmar que
su proxy ve esa misma IP antes de escribirla en su ACL. El preflight solo
acepta hosts exactos (`/32` en IPv4 o `/128` en IPv6), nunca `/24`, una subnet
Docker o una red abierta. La auditoría permanece
desactivada hasta que Grumphya confirme claves, ACL, rutas JSON, atestación,
TLS y roles PostgreSQL.

Cuando el contrato esté aceptado, la ejecución opt-in usa el perfil Compose
`internal-audit` y `DEVELOPMENT_SECURITY_AUDIT_SECRETS_DIR`. Ese directorio
debe contener `audit_jwt_private.pem` y
`release_attestation_public.pem`, ambos gestionados fuera de Git.
El servicio no tiene acceso a la base de datos y solo se conecta a la red de
egress. El stack ordinario no lo arranca.
