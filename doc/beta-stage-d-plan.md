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
certificación por sí solo. El proyector solo convierte en criterios los
checks D-03 explícitos de dependencias auditadas, secretos fuera de la imagen
y superficie API allowlisted; el snapshot D-02 solo proyecta TLS cuando hay
transporte verificado y mantiene la cobertura incompleta para red, privilegios
o cabeceras que no estén demostrados. El lector de producción fija el origen
`https://grumphya.com`, usa GET sin credenciales y valida cada respuesta con el
parser de su recurso; el inventario de dependencias permanece bloqueado hasta
que exista un contrato explícito.

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
| D-08 · integración y certificación | Ejecutar auditoría privada completa sobre Grumphya y actualizar estados de certificación sin falsear pendientes | Orquestador, persistencia, informe privado y enlace con sello; depende de D-07 y del contrato operativo | Primero: recorrido integral con datos sintéticos, fallo seguro y reanudación. Aceptar con resultados reales de producción y trazabilidad | Riesgo de conceder certificación incompleta. Evidencia: informe privado acotado y transición registrada. Excluye modificar el repositorio de Grumphya |

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
