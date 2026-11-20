# Plan incremental de la etapa D

## Objetivo y límites

D incorpora comprobaciones internas sobre lo realmente desplegado en producción
de Grumphya. Usará accesos automatizados, de solo lectura y con permisos
mínimos. No consultará ni extraerá datos privados de usuarios, no modificará
producción, no ejecutará pruebas destructivas y no sustituirá las evidencias
externas ya cubiertas por A y B.

La implementación de D comienza con el contrato local D-01. Cada entrega
deberá seguir TDD, mantener TypeScript estricto y aportar evidencia de
producción antes de considerarse aceptada. El contrato y el evaluador interno
separado ya están implementados como D-01/D-07 localmente: el evaluador
devuelve categorías, cobertura y un score interno nullable, sin mezclarlo con
el score externo. El contrato actual solo permite
solicitudes explícitas para `grumphya.com` en `production`, con el auditor
`desarrollo-seguro`, scopes allowlisted y retención máxima de 30 días. Las
evidencias se aceptan como estados, códigos y timestamps; se rechazan HTML,
cabeceras, cookies, secretos y texto libre. Este contrato no concede acceso ni
simula evidencias de producción. D-02 ya valida snapshots de infraestructura
con digest SHA-256, exposición, privilegios y transporte TLS allowlisted, sin
comandos, rutas, variables ni datos de base de datos. D-03 añade una
atestación de producción con digest del artefacto, digest de dependencias y
códigos de controles allowlisted, sin guardar SBOM, código fuente ni secretos.
D-04 añade observaciones de autenticación sintética con una referencia hash y
flujos de login, frontera de autorización y logout; no admite credenciales ni
identificadores de usuarios reales. D-05 añade observaciones acotadas de E2E,
rendimiento, accesibilidad y responsive: solo conserva un código de métrica,
un valor con unidad y límites, un hash de muestra y la fecha; no conserva
HTML, capturas, trazas, URLs ni datos de usuario. D-06 añade señales
agregadas de almacenamiento, terceros, consentimiento, transparencia y
minimización: conserva códigos y contadores booleanos, sin nombres de cookies,
dominios, textos, scripts ni conclusiones sobre venta de datos.
El proyector D-07 traduce observaciones tipadas a un único criterio interno,
rechaza duplicados antes de puntuar y mantiene `externalScore` en `null`.
El ensamblador D-08 produce un informe interno redacted para
`grumphya.com`/`production`, con referencia hash, evidencia proyectada y
estado incompleto o bloqueado cuando faltan controles; nunca eleva una
certificación por sí solo. El runner D-08 coordina lecturas allowlisted de
forma secuencial y devuelve un fallo categórico sin fabricar un informe si
un recurso no está disponible o es inválido; las operaciones duplicadas se
rechazan antes de abrir conexiones. El proyector solo convierte en criterios los
checks D-03 explícitos de dependencias auditadas, secretos fuera de la imagen
y superficie API allowlisted; el snapshot D-02 solo proyecta TLS cuando hay
transporte verificado y mantiene la cobertura incompleta para red, privilegios
o cabeceras que no estén demostrados. El lector de producción fija el origen
`https://grumphya.com`, usa GET sin credenciales, exige `2xx` con
`Content-Type: application/json` y una ruta allowlisted exacta para cada
recurso, y valida cada respuesta con el parser de su recurso; el inventario de
dependencias se limita a contadores de
riesgo y un digest, sin nombres de paquetes ni SBOM.

## Orden propuesto

| ID | Objetivo y controles | Componentes afectados y dependencias | Tests TDD y aceptación | Riesgos, evidencias y exclusiones |
| --- | --- | --- | --- | --- |
| D-01 · contrato y acceso | Definir objetivo de producción, identidad de auditoría, permisos mínimos, retención y catálogo de evidencias | Contrato compartido, adaptador de acceso y documentación; requiere autorización de Grumphya y cuenta de solo lectura | Primero: matriz de permisos, validación de secretos, redacción y rechazo de destinos no autorizados. Aceptar cuando la cuenta solo acceda a recursos aprobados y la auditoría sea trazable | Riesgo de sobrealcance. Evidencia: contrato firmado, prueba de permisos y logs categóricos. Excluye credenciales de usuarios y acceso a bases de datos de cliente |
| D-02 · infraestructura | Evaluar contenedores, servicios, privilegios, red, cifrado interno, interfaces expuestas y configuración técnica de PostgreSQL sin leer datos | Adaptador de inventario y proyección de evidencias; depende de D-01 | Primero: fixtures de inventario, allowlist de rutas/campos y pruebas de no modificación. Aceptar con evidencias de producción reproducibles | Riesgo de filtrar topología sensible. Evidencia: snapshot acotado y hash de despliegue. Excluye cambios, shell arbitraria y contenido de BD |
| D-03 · aplicación y dependencias | Evaluar artefacto desplegado, dependencias aplicables, vulnerabilidades conocidas, configuración de producción, secretos y APIs internas | Adaptador de attestation/SBOM y controles de API; depende de D-01 y D-02 | Primero: parser de artefactos, correlación de versión y redacción. Aceptar solo si la evidencia corresponde al despliegue real | Riesgo de analizar código distinto al desplegado. Evidencia: digest/versión, SBOM y resultados allowlisted. Excluye repositorios o ramas no desplegadas |
| D-04 · autenticación y autorización | Comprobar sesiones, permisos, aislamiento y accesos indebidos usando cuentas y datos sintéticos propios de la auditoría | Cliente E2E autenticado y fixtures sintéticos; depende de D-01 y del contrato de Grumphya | Primero: flujos de login sintético, aislamiento entre cuentas y cierre de sesión. Aceptar sin tocar datos reales ni forzar credenciales | Riesgo de afectar cuentas. Evidencia: resultados sintéticos y trazas sin identificadores. Excluye fuerza bruta, enumeración y pruebas destructivas |
| D-05 · calidad y experiencia | Medir flujos E2E, rendimiento acotado, accesibilidad, compatibilidad y responsive | Runner de navegador y proyección de métricas; depende de D-03 y D-04 | Primero: escenarios de bajo impacto, límites de carga y comprobaciones de accesibilidad. Aceptar cuando las medidas procedan de producción y sean reproducibles | Riesgo de carga. Evidencia: muestras acotadas con timestamp y versión. Excluye stress tests, fuzzing y controles ya cubiertos externamente |
| D-06 · privacidad y ética | Verificar almacenamiento local, terceros, coherencia de privacidad, tratamiento de datos, transparencia de IA y controles éticos de IA | Observador de navegador y reglas éticas; depende de D-03 y D-04 | Primero: interceptación de terceros, revisión de declaraciones y estados de consentimiento. Aceptar si la conducta observada coincide con la declaración | Riesgo de inferir prácticas no observables. Evidencia: señales observables y limitaciones explícitas. Excluye conclusiones legales o ventas de datos no verificables |
| D-07 · puntuación interna | Integrar hallazgos internos con categorías y puntuaciones separadas de la evaluación externa | Motor de evaluación y modelo de informe; depende de D-02 a D-06 | Primero: pesos, redondeo, `unknown`, `not_applicable`, críticos y no duplicación. Aceptar solo con evidencias internas completas | Riesgo de mezclar auditorías o penalizar dos veces. Evidencia: desglose por criterio y origen. Excluye global absoluta hasta cobertura suficiente |
| D-08 · integración y certificación | Coordinar una auditoría privada acotada sobre Grumphya y preparar la actualización de estados sin falsear pendientes | `internal-audit-runner`, lector allowlisted, informe privado y futura persistencia; depende de D-07 y del contrato operativo | TDD local cubre lectura secuencial, separación de puntuación, rechazo de duplicados y fallo seguro sin informe. Aceptar producción solo tras disponer de recursos y datos sintéticos autorizados | Riesgo de conceder certificación incompleta. Evidencia: informe privado acotado y transición registrada. Excluye modificar el repositorio de Grumphya |

## Intervenciones necesarias en Grumphya

Antes de D-01 deben acordarse, fuera de este repositorio:

- identidad y permisos de la auditoría;
- recursos de producción autorizados;
- cuentas y datos sintéticos;
- attestation de despliegue, versión o SBOM;
- documentación de privacidad, terceros e IA;
- retención, contacto de incidencias y revocación de acceso.

Si alguno de estos contratos no existe, D queda pendiente sin sustituirlo por
fixtures o análisis del repositorio.

El contrato operativo que debe entregar Grumphya antes del preflight está
desglosado en [`beta-stage-d-grumphya-handoff.md`](beta-stage-d-grumphya-handoff.md).
La matriz de criterios, propiedad de cada recurso y esquema allowlisted para
señales compuestas está en la sección «Matriz aclaratoria para completar la
cobertura D» de ese contrato; cualquier ampliación del parser debe publicarse
coordinadamente en ambos repositorios.

El informe interno rechaza evidencias posteriores al instante de la auditoría
y el runner comprueba scopes finos para las señales de ética e IA antes de
proyectarlas. También admite cancelación cooperativa antes o durante una
lectura sin crear un informe parcial. Esto evita mezclar observaciones de
ejecuciones distintas o conceder cobertura por una autorización más amplia de
la necesaria.

## Preflight de recursos de producción (18 de noviembre de 2026)

Se comprobó mediante `GET` sin credenciales y sin seguir redirecciones el
catálogo provisional de recursos (`/audit/infrastructure`, `/audit/deployment`,
`/audit/dependencies`, `/audit/auth`, `/audit/quality`, `/audit/privacy` y
`/audit/ai`). Todos respondieron `200 text/html` con la página pública de
Grumphya, no con un contrato JSON de auditoría. El lector de D los clasifica
como evidencia inválida y el runner devuelve un fallo seguro sin crear un
informe parcial. Esta comprobación no conserva el cuerpo ni lo usa como
evidencia.

Por tanto, D dispone del contrato, el lector, la proyección, la puntuación
separada y el runner probados localmente, pero no tiene todavía recursos de
producción autorizados. Para activar la validación operativa hay que acordar
en el repositorio de Grumphya las rutas, el formato JSON acotado, la identidad
de solo lectura y las cuentas sintéticas de autenticación. Hasta entonces no
se ejecuta una auditoría interna ni se presenta una puntuación interna.

La puerta reproducible `pnpm audit:resources:preflight` repite esta
comprobación sin enviar JWT, cookies ni cuerpos: exige que cada ruta exista,
devuelva una respuesta JSON y rechace la petición anónima con `401` o `403`.
Cuando un recurso falta, emite una línea categórica con su nombre y no
conserva la respuesta. En el estado actual la puerta falla con
`internal_audit_resource_unavailable` porque Grumphya aún publica `404` en el
catálogo provisional; no se interpreta como evidencia de producción.

La puerta estática `test-internal-audit-route-policy.mjs` mantiene sincronizados
los siete pares recurso/ruta entre el preflight, la autorización, el runtime y
el runner. Un cambio de catálogo que olvide una de esas capas falla en CI antes
de poder desplegarse.

El worker incluye una entrada opt-in `pnpm --filter
@desarrolloseguro/worker audit:run`. Solo construye el JWT técnico y ejecuta
las siete operaciones allowlisted, incluida la ruta dedicada `/audit/ai`, cuando
`AUDIT_ENABLED=true` y todas las claves restringidas están disponibles; no forma
parte del arranque normal, no acepta dominios o rutas por argumentos y solo
emite un resumen JSONL privado con la puntuación interna, su estado, categorías
y cobertura. El resumen fija `externalScore=null` y no incluye evidencias,
razones detalladas ni datos de terceros. La ruta de privacidad no puede
transportar la señal de divulgación de IA: el runner la rechaza si no llega por
`/audit/ai`. Si `AUDIT_SCOPES` limita el alcance, el runtime solo construye las
operaciones correspondientes; `ethics` requiere también `privacy`, porque esa
es la ruta de transporte de la transparencia ética. No se ejecuta ni se activa
mientras Grumphya no entregue el contrato de producción.

El aprovisionamiento local de la identidad DS está separado del arranque:
`pnpm audit:identity:provision` genera una única clave Ed25519 privada y su
PEM público con permisos restringidos, calcula una huella pública y termina
con `enabled=false`. No sobrescribe claves existentes ni intenta adivinar la
ACL de red. El operador comparte solo el PEM público y la huella con
Grumphya; el `kid` y `AUDIT_ALLOWED_NETWORKS` se coordinan antes de cualquier
activación.

El Compose incorpora `development-security-internal-audit` bajo el perfil
`internal-audit`. No se inicia con el stack normal, no monta PostgreSQL y solo
puede salir por la red de egress de Desarrollo Seguro. Antes de lanzarlo, el
operador debe montar en `DEVELOPMENT_SECURITY_AUDIT_SECRETS_DIR` la privada JWT
de DS y la pública de atestación del despliegue externo, y proporcionar la ACL y los
`kid` activos mediante variables de entorno. Con `AUDIT_ENABLED` ausente o a
`false` el contenedor termina con `internal_audit_disabled`; las claves no se
copian ni se leen en ese caso.

La comprobación inicial del 19 de noviembre de 2026 dejó el preflight D en
estado pendiente: las siete rutas públicas de Grumphya (`infrastructure`,
`deployment`, `dependencies`, `auth`, `quality`, `privacy` y `ai`) respondían
`404 application/json`, y aún no estaba instalada la clave pública de
atestación. Ese estado histórico fue resuelto posteriormente; la ejecución
autorizada y sus límites se registran en el addendum operativo al final de este
documento.

En la misma fecha se comprobó desde el VPS la ruta de salida IPv4 del cliente
de Desarrollo Seguro: `src=31.70.130.181` (IP pública observada por el host).
Ese valor queda como candidato `31.70.130.181/32` para
`AUDIT_ALLOWED_NETWORKS`; no se activa ni se considera válido hasta que el
proxy de Grumphya confirme la IP que recibe realmente.

## Addendum operativo — 19 de noviembre de 2026

El contrato externo quedó provisionado y el proxy de Grumphya confirmó la ACL
real de hairpin (`172.30.0.1/32`). También están instaladas las claves públicas
JWT y de atestación, los `kid` allowlisted y los roles PostgreSQL separados.
Con `AUDIT_ENABLED=true` en Grumphya, la auditoría privada completó las siete
lecturas autenticadas y produjo un informe `incomplete` con `6/14` criterios.

Este resultado sustituye el estado de preflight pendiente descrito arriba solo
para la validación de transporte y contrato: no convierte los criterios sin
evidencia en resultados, no emite certificación y no habilita un sello. La
evidencia resumida y sus límites están en
[`beta-stage-d-assessment.md`](beta-stage-d-assessment.md).

## Addendum operativo — 20 de noviembre de 2026

Se repitió la auditoría privada en un contenedor efímero del VPS con el perfil
`internal-audit`, sin montar la base de datos ni alterar el stack normal. La
ejecución completó las siete lecturas autenticadas y produjo el
`auditRef` `sha256:a6a4406c8a252e98a4644f462fea9b2c9d8d9200bb488707c7e6bb899ea72ef5`
(`observedAt=2026-11-20T07:55:58.785Z`). El resultado fue `incomplete`, con
`6/14` criterios, `internalScore=null` y `externalScore=null`: autenticación e
IA quedaron en `100/100` en el alcance observado; infraestructura, aplicación,
calidad y privacidad siguen parciales y ética sin evidencia. El perfil se
apagó al terminar y no se activó ninguna certificación ni se modificó
Grumphya.

