# Prompt para el agente de Grumphya

Implementa el resto de la integración de auditoría privada D en el repositorio
de Grumphya. No modifiques Desarrollo Seguro ni actives `AUDIT_ENABLED=true`
hasta que todos los preflights y pruebas pasen.

## Contrato de identidad

- Acepta únicamente JWT EdDSA de Desarrollo Seguro.
- `iss` exacto: `desarrolloseguro-audit`.
- `aud` exacto: `grumphya-audit`.
- `environment` exacto: `production`.
- `domain` exacto: `grumphya.com`.
- `scope` debe contener únicamente valores `audit:<recurso>` allowlisted.
- Exige `kid` allowlisted, `iat`/`exp` con TTL máximo de 5 minutos y tolerancia
  de reloj máxima de 60 segundos.
- Rechaza cookies, JWT de usuario, credenciales en URL, métodos distintos de
  `GET`, consultas, redirecciones y rutas no allowlisted.

Configura en `/opt/grumphya/.secrets/grumphya_env`, sin registrar valores:

- `AUDIT_TECHNICAL_AUTH_PUBLIC_KEY` (PEM pública de Desarrollo Seguro).
- `AUDIT_TECHNICAL_AUTH_ALLOWED_KIDS` (los `kid` exactos y activos).
- `AUDIT_ALLOWED_NETWORKS` (la IP/CIDR que vea realmente el proxy; no uses una
  red Docker compartida ni una red abierta).
- `AUDIT_RELEASE_MANIFEST_PUBLIC_KEY` (PEM pública de la atestación de
  releases).

## Recursos y escritura

Publica las rutas JSON versionadas allowlisted bajo `/audit/` con la envolvente
`beta-d-0.2` y la atestación EdDSA definida en el handoff. Una petición sin
identidad o con claims inválidos debe devolver un rechazo categórico y no tocar
la base de datos.

Las rutas de lectura no son un canal de escritura. Implementa un canal de
ingesta autenticado, allowlisted y TLS para las evidencias que envíe Desarrollo
Seguro. No compartas redes Docker entre aplicaciones ni aceptes conexiones sin
TLS.

## PostgreSQL y retención

Elige y documenta la opción de menor privilegio, preferentemente:

1. rol de API con `SELECT` únicamente sobre `audit.evidence` y
   `audit.release_attestations`;
2. rol de mantenimiento/retención independiente con `DELETE` limitado a esas
   tablas y a las ventanas de retención aprobadas;
3. rol de ingesta separado para insertar únicamente evidencias válidas.

Si por compatibilidad la retención sigue ejecutándose con la conexión de la
API, documenta y prueba explícitamente los dos `DELETE`; no presentes una API
como estrictamente de solo lectura en ese caso. Usa la base de Grumphya,
conexiones TLS, credenciales rotables y sin compartir la base de Desarrollo
Seguro.

## Atestación y despliegue

- Genera el par Ed25519 en un entorno controlado.
- Guarda la privada exclusivamente como secreto de GitHub Actions:
  `AUDIT_RELEASE_SIGNING_KEY`.
- Instala solo la pública en `grumphya_env` y entrégala también para que
  Desarrollo Seguro pueda verificarla.
- Añade preflight fail-closed, pruebas unitarias/integración y un smoke
  autenticado que compruebe firma, `kid`, claims, ACL, TLS, cardinalidad,
  expiración y permisos PostgreSQL.
- Mantén `AUDIT_ENABLED=false` hasta que todas esas pruebas pasen en producción.

Entrega: commit Conventional Commits, documentación operativa, matriz de
permisos, evidencia de pruebas y los nombres de los valores pendientes, nunca
los secretos. No conviertas fixtures en evidencia de producción.
