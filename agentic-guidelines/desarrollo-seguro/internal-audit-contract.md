# Contrato de auditoría interna D-01

La auditoría privada de la etapa D solo puede dirigirse a `grumphya.com` en
`production` y mediante el auditor `desarrollo-seguro`. El contrato compartido
en `core` valida los scopes de infraestructura, aplicación, autenticación,
calidad, privacidad, ética e IA y limita la retención de evidencias a 30 días.

Una evidencia interna contiene únicamente `criterionId`, `scope`, `status`,
`source`, `observedAt` y `reasonCode`. Los criterios y códigos están
allowlisted. No se aceptan HTML, cabeceras completas, cookies crudas, secretos,
identificadores de usuario, texto libre ni destinos alternativos. El snapshot
de infraestructura D-02 solo conserva nombres seguros, digests SHA-256,
exposición, privilegios y estado de transporte; nunca comandos, rutas,
variables de entorno o datos de bases. La atestación D-03 solo conserva
digests SHA-256 y códigos de controles allowlisted; no recibe SBOM completo,
código fuente ni secretos. Las observaciones D-04 de autenticación solo
identifican una cuenta sintética mediante hash y un flujo allowlisted; nunca
conservan credenciales, tokens, correos o IDs de usuarios reales. Las
observaciones D-05 solo conservan códigos de métrica allowlisted, valores
acotados con unidad, hash de muestra y timestamp; nunca HTML, capturas,
trazas, URLs ni datos de usuario.
Las observaciones D-06 solo conservan señales agregadas allowlisted de
almacenamiento, terceros, consentimiento, transparencia y minimización; no
conservan nombres de cookies, dominios, textos, scripts ni permiten inferir
venta de datos.
El proyector D-07 transforma cada observación tipada en un criterio interno,
rechaza criterios duplicados antes del cálculo y conserva `externalScore` en
`null`.
El ensamblador D-08 solo genera un informe interno para
`grumphya.com`/`production` con una referencia hash y evidencia ya proyectada;
si falta cobertura devuelve estado incompleto o bloqueado y no concede sello ni
certificación.
De D-03 solo se proyectan a puntuación los checks explícitos de dependencias,
secretos fuera de la imagen y superficie API allowlisted; los demás no se
reinterpretan como controles distintos.
El snapshot D-02 solo proyecta `infrastructure.tls` si contiene transporte
verificado; no convierte exposición o privilegios en conclusiones sobre red o
cabeceras. El lector de producción fija el origen `https://grumphya.com`, usa
GET con una identidad técnica JWT EdDSA de corta duración y valida cada JSON
con el parser del recurso. El JWT incluye `iss`, `sub`, `aud`, `iat`, `exp`,
`jti`, `kid`, `hostname`, `environment` y `scope`; no se envía ninguna cookie
ni credencial de usuario. El inventario
de dependencias solo conserva contadores de riesgo y un digest; no conserva
nombres de paquetes ni un SBOM.

El runner D-08 ejecuta las lecturas allowlisted una a una y compone el informe
interno solo cuando todos los recursos solicitados se han podido validar. Si
una lectura falla o una respuesta es inválida, devuelve una categoría de fallo
y ningún informe parcial; el reintento debe iniciar una nueva ejecución con un
`auditRef` nuevo. No se reintenta en paralelo ni se reutilizan respuestas de
una ejecución anterior. Además, comprueba el scope efectivo de la evidencia
después de validarla: una señal de divulgación de IA requiere `ai` y una señal
de transparencia ética requiere `ethics`, aunque ambas lleguen por el recurso
agregado de privacidad. El informe también rechaza evidencias con timestamp
posterior al instante de la auditoría. La ejecución acepta un `AbortSignal`;
si se cancela antes o durante una lectura, no construye informe parcial y
devuelve únicamente `internal_audit_cancelled`.

Las respuestas de producción usan la envolvente `beta-d-0.2` con las claves
exactas `schemaVersion`, `observedAt`, `validUntil`, `environment`,
`deploymentDigest`, `cardinality`, `evidence` y `attestation`. `cardinality` es
exactamente `1` en esta versión; el lector rechaza arrays, respuestas fuera de
la ventana de 24 horas, timestamps futuros, HTML, firmas inválidas y `kid`s no
allowlisted. La atestación EdDSA firma la serialización canónica de todos los
campos salvo `attestation`; la clave pública se fija en Desarrollo Seguro y se
rota con solapamiento de `kid`s.

El adaptador de acceso D-01 autoriza únicamente operaciones `GET` contra
recursos allowlisted y rutas sin query, fragmento, salto de directorio ni
credenciales embebidas en la URL. El JWT solo viaja en la cabecera
`Authorization`; no abre conexiones por sí mismo, no concede permisos a Grumphya
y no convierte fixtures en evidencias de producción. El evaluador interno conserva el score externo en `null` y solo
calcula una puntuación interna cuando hay cobertura completa; `unknown` deja
la evaluación incompleta y un fallo crítico la bloquea. D-02 a D-08 requieren
después autorización, recursos y pruebas operativas acotadas.
