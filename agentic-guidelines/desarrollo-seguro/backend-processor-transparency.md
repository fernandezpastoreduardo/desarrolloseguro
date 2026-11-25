# Transparencia de proveedores backend en informes públicos

## Propósito

Resolver la cobertura desconocida de `DS-PRIV-04` sin confundir las
solicitudes de terceros observadas desde el navegador con servicios backend
servidor a servidor. La observación web de Solistos permanece separada de un
inventario interno autenticado de procesadores externos activos.

El informe público enumera, para cada proveedor backend detectado, su nombre,
propósito declarado por Grumphya y el enlace a la sección de su política de
privacidad. Las declaraciones de la política se presentan como declaraciones
del titular; el evaluador no presume que sean falsas ni intenta verificar los
contratos o condiciones del proveedor. La comprobación mide inventario y
transparencia de la declaración.

## Contrato con Grumphya

El prompt autónomo del contrato se entregó primero en la conversación. El
endpoint coordinado es `GET /audit/processors`, protegido por el JWT técnico y
el scope existente `audit:privacy`. Su respuesta usa `schemaVersion` separado
`processor-inventory-v1`, no modifica envolturas `beta-d-0.2`, y se firma con
EdDSA usando la identidad de release ya configurada.

La respuesta es un objeto plano firmado (no la envoltura `beta-d-0.2`) con:

- `schemaVersion`, `observedAt`, `validUntil`, `environment`, `hostname`,
  `deploymentDigest`, `inventoryStatus`, `privacyPolicy`, `processors` y
  `attestation`.
- `inventoryStatus` es `complete` o `incomplete`.
- Cada procesador activo incluye `providerId`, `displayName`, `product`,
  `disclosureStatus`, `purpose`, `policyUrl` y `declaredStatements`.
- `disclosureStatus` es `published` o `missing`.
- Tamaño máximo: 64 KiB; máximo 32 proveedores; máximo 10 declaraciones por
  proveedor; máximo de vigencia: 24 horas. El identificador de firma esperado
  es `grumphya-release-2026`.
- El enlace declarado de política debe pertenecer a
  `https://grumphya.com/politica-de-privacidad` y apuntar a una sección de
  proveedores. La respuesta fija política y revisión para poder indicar qué
  texto estaba vigente al generarse el informe.
- Un inventario completo vacío acredita que no se encontraron adaptadores de
  procesadores externos activos en el registro de producción cubierto. No
  acredita ausencia de llamadas en otros sistemas o alcances.
- Un proveedor activo omitido por la política conserva su nombre y estado
  `missing`; no se inventan propósito ni declaraciones.
- La política publicada es autoritativa para las condiciones que declara. La
  evidencia no contiene contratos, secretos, valores de configuración,
  solicitudes, prompts ni datos de usuarios.
- Se aplican los límites y reglas de autenticación, firma, frescura y payload
  del contrato compartido con Grumphya.

Si la lectura, la verificación criptográfica, la frescura o la validación de
esquema fallan por una limitación del auditor, el componente queda sin
cobertura y `DS-PRIV-04` queda `unknown` hasta resolver el error de
observabilidad. Un endpoint que no exista o no esté desplegado se considera
falta de capacidad declarativa del dominio si el auditor funciona correctamente.

## Evaluación y estados

`DS-PRIV-04` mantiene su peso actual y su semántica pasa a ser la transparencia
del inventario de procesadores backend. Este cambio de significado requiere
una nueva versión de la rúbrica ética, `domain-ethics-v4`; los informes
históricos mantienen su versión y significado anteriores. La fórmula global
`mvp-global-v1` conserva sus pesos y redondeo. El criterio recibe evidencia
exclusivamente del recurso firmado de inventario:

- `pass`: inventario completo y cada procesador activo está publicado en la
  política, o inventario completo sin procesadores backend externos activos.
- `fail`: inventario completo identifica al menos un procesador activo con
  `disclosureStatus=missing`. El hallazgo describe falta de divulgación, no
  atribuye uso indebido ni falsedad.
- `fail`: el endpoint no está disponible porque el dominio no ofrece la
  capacidad acordada, o una respuesta válida y firmada declara
  `inventoryStatus=incomplete`.
  El servicio se pudo consultar correctamente, pero Grumphya no puede enumerar
  todos los procesadores activos; es una falta de transparencia/cobertura del
  dominio, no un error del lector.
- `unknown`: fallo atribuible al lector/auditor, respuesta ausente o vencida,
  firma o digest inválidos, o esquema no válido. No penalizar al dominio por
  errores propios de observabilidad.

Las afirmaciones explícitas de tratamiento se muestran como declaraciones
textuales del titular y no alteran por sí mismas la nota ni se verifican frente
a términos externos. El criterio no califica si un proveedor entrena modelos,
rastrea o conserva datos: registra qué declara la política y si incluye a los
proveedores activos.

La evidencia pública de Solistos sigue indicando por separado hosts,
solicitudes, cookies y proveedores observados desde el navegador en el alcance
medido. Un cero de esa observación no se convierte en un inventario backend
vacío, y una llamada backend no se representa como una solicitud del navegador.

## Proyección pública y persistencia

La API solo proyecta la lista segura y la atestación verificada que son
necesarias para informar: nombre y producto declarados, propósito, estado de
divulgación, declaraciones de política, URL de política, estado/frescura del
inventario y referencia del digest de despliegue. Nunca publica tokens,
cabeceras de autenticación, claves, valores de configuración, prompts, cuerpos
de solicitudes, logs, IP internas o identificadores de usuarios.

La proyección debe quedar ligada al informe público y a su instante de
observación; las lecturas históricas no se actualizan silenciosamente con una
política o configuración posterior. La persistencia será una columna JSONB
aditiva asociada al informe y protegida por la misma regla de inmutabilidad que
el resto del informe. Almacena solo la proyección allowlisted y metadatos de
integridad; nunca se persiste la respuesta cruda ni material de autenticación.

La lectura se realiza mediante un auditor aislado que conserva la clave JWT y
la clave pública de atestación. Worker y auditor se comunican por un socket
Unix en un volumen dedicado, con permisos mínimos y protocolo JSONL acotado.
El worker solo puede solicitar el inventario del host fijo `grumphya.com`; no
puede indicar URL, método, ruta, scope ni cabeceras. El auditor no accede a la
base de datos ni al socket Docker. Un fallo del socket o del auditor produce
`unknown` en la evaluación y no detiene el análisis público ya completado.

El despliegue ordinario debe habilitar este lector acotado cuando estén
provisionadas sus credenciales y la ACL exacta de egress. Esta activación es
distinta de la auditoría privada completa: `COMPOSE_PROFILES` permanece vacío y
`development-security-internal-audit` no se inicia. El lector solo puede hacer
`GET /audit/processors` con el scope `privacy`. Debe montar las credenciales
gestionadas y usar la ACL exacta confirmada; si falta una credencial o la
configuración es inválida, el healthcheck del auditor debe fallar en vez de
dejar publicado indefinidamente un resultado `unknown`. El bind mount del
auditor contiene solo esos dos ficheros, con propietario root y modo `0400`;
no se monta el directorio general de secretos ni quedan accesibles credenciales
de PostgreSQL.

El deploy debe iniciar explícitamente `development-security-processor-auditor`
y esperar a que su healthcheck confirme el socket antes de actualizar el worker.
El worker se arranca con `docker compose up --no-deps`; por tanto, Compose no
iniciará automáticamente el auditor declarado en `depends_on`. Si el auditor
no queda saludable, el deploy debe detenerse antes de arrancar/reemplazar el
worker, manteniendo el release anterior operativo.

## Criterios de aceptación

1. La observación de navegador y el inventario backend son dimensiones de
   evidencia distintas y pueden dar resultados diferentes en el mismo informe.
2. Una respuesta válida y completa lista OpenAI y Desarrollo Seguro cuando sus
   adaptadores estén activos; no incluye proveedores desactivados.
3. El inventario completo vacío es distinto de inventario incompleto y aporta
   evidencia positiva solo sobre el registro de integraciones de producción
   cubierto.
4. Los proveedores activos publicados aparecen en el informe con nombre,
   propósito declarado y enlace funcional a la política.
5. Un proveedor activo omitido se lista como falta de divulgación sin inventar
   sus condiciones de tratamiento ni acusar falsedad.
6. El texto de tratamiento se identifica como declaración de Grumphya y no se
   contrasta con contratos o términos externos.
7. La ausencia del endpoint y un inventario válido `incomplete` producen
   `fail` cuando el lector funciona; fallos del auditor al leer o verificar
   una respuesta producen `unknown` sin atribuirlos al dominio.
8. La evidencia está firmada, acotada, libre de secretos y datos personales, y
   asociada al mismo release que la sirvió.
9. Los informes históricos no cambian de significado al actualizar el
   inventario o la política.
10. El despliegue ordinario activa el lector de inventario con credenciales y
    ACL provisionadas, pero mantiene detenido el perfil de auditoría privada.
11. La prueba del despliegue exige `domain-ethics-v6` con los ocho criterios
    evaluados. Para Grumphya, un `unknown` cuyo `reasonCode` sea
    `auditor_error` se conserva en el informe y se imprime como diagnóstico no
    bloqueante; no puede impedir desplegar Desarrollo Seguro. El smoke no debe
    convertirlo en `pass` ni `fail`. El resto de fallos de informe, cobertura y
    salud de Desarrollo Seguro continúa bloqueando el deploy. Un inventario
    incompleto o no divulgado atribuible al dominio puede quedar como un
    `fail` evaluado.
12. El script de deploy espera saludable al auditor de inventario antes de
    actualizar el worker y falla de forma segura si el socket no está listo.

## Secuencia

1. Implementar y probar el endpoint y la página de política de Grumphya contra
   el prompt contractual. No desplegar desde este repo.
2. Añadir el auditor aislado, su socket local y el lector autenticado de
   `GET /audit/processors`; validar firma, versión, frescura y límites.
3. Solicitar el snapshot desde el worker para análisis manuales y periódicos de
   `grumphya.com`, y persistirlo atómicamente junto al informe mediante una
   migración aditiva; mantener compatibilidad histórica.
4. Derivar `DS-PRIV-04` en `domain-ethics-v4`, mostrar la observación de
   navegador separada de los proveedores backend y atribuir las declaraciones
   explícitamente a Grumphya.
5. Documentar el resultado para personas en `doc/`, limpiar la idea aplazada si
   aparece en `wanna-bes.md`, y verificar contrato, integración, historial,
   presentación, workflow y deploy autorizados de Desarrollo Seguro.
