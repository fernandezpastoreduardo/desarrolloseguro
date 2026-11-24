# Auditoría de proveedores y documentación pública

## Estado

Feature aprobada para implementación por fases. Esta especificación gobierna el
trabajo del goal activo y sustituye, para estas comprobaciones nuevas, las
restricciones históricas incompatibles de las guías de transparencia pública.
No modifica Grumphya ni otros dominios auditados.

## Objetivo

Revisar el acceso inicial a la información legal del sitio, identificar todos
los proveedores relevantes que reciben o pueden recibir datos en los flujos
observados y contrastar las declaraciones públicas del sitio con documentación
oficial del proveedor. El informe debe preservar las pruebas de cada fuente y
nombrar directamente los incumplimientos legales que la evidencia y el mapeo
legal vigente acrediten.

## Comprobación de primera entrada

- Auditar la primera página de entrada en un contexto limpio.
- Cuando se muestre un aviso de cookies, CMP u otro mecanismo equivalente para
  solicitar consentimiento, comprobar que ese mismo componente presenta un
  enlace visible y operativo a la documentación de privacidad pertinente.
  Un enlace en el footer no satisface este criterio.
- Cuando se compruebe que no hay cookies de terceros ni solicitud de
  consentimiento, el enlace del footer puede satisfacer el acceso a la
  documentación.
- Un aviso informativo que comunica que no se usan cookies no técnicas y
  muestra un enlace operativo a la política no es una solicitud de
  consentimiento. Se registra como enlace visible de primera entrada y pasa
  si el inventario completo confirma que no hay cookies de terceros; no se
  exige un botón de rechazo ni se registra un incumplimiento por su ausencia.
- La lectura de ese enlace se ejecuta además en un contexto nuevo y limpio:
  cargar la página inicial, identificar de nuevo el enlace visible pertinente,
  navegar al documento sin pulsar botones informativos ni controles de
  consentimiento y capturar el estado posterior. Registrar acceso al documento,
  tiempo monotónico, nombres/dominos/atributos de cookies y nombres/dominos/tipo
  de almacenamiento, sin valores. Mantener intacta y separada la instantánea
  anterior a la elección. La ausencia de un control de rechazo en un aviso
  informativo no se convierte en hallazgo por esta inspección.
- Seguir el enlace visible y registrar el documento y la evidencia de acceso.
- En el primer estado visible, identificar el componente de consentimiento por
  sus controles de aceptar/rechazar/configurar y comprobar dentro de ese mismo
  componente si hay un enlace visible a información de privacidad, cookies,
  términos o aviso legal. Un enlace que solo aparece en otra zona de la página
  (incluido el footer) no cumple mientras exista ese componente. Registrar
  ubicación, host y ruta públicas del enlace y si la navegación al documento
  devuelve contenido accesible; no guardar query strings ni fragmentos.
- Si no se detecta solicitud de consentimiento, el enlace del footer puede
  cumplir solo si la inspección completa del contexto inicial confirma que no
  hay cookies de terceros. La existencia de solicitudes de red a terceros, por
  sí sola y sin cookies de terceros ni una solicitud de consentimiento, no
  invalida esta excepción; la recepción de datos por esos servicios se evalúa
  por separado en el inventario y el contraste de proveedores.
- Distinguir ausencia comprobada de enlace/documentación de un fallo del propio
  auditor al navegar o leer. Los errores propios conservan su código diagnóstico
  y no se atribuyen al sitio.

## Detección y catálogo de proveedores

- El universo no se limita a cookies ni a solicitudes de navegador. Incluye
  servicios de frontend y backend, APIs, alojamiento, correo/SMTP, analítica,
  seguridad, moderación, pagos y otros tratamientos que aparezcan en evidencia
  pública o en el flujo técnico auditado.
- Identificar por separado: proveedor, producto/modalidad, función declarada,
  categorías de datos, destinatarios/subencargados, ubicación/región, retención,
  transferencias y controles documentados cuando la fuente permita observarlos.
- Cuando aparezca un proveedor desconocido, consultar su documentación oficial
  pertinente, registrarlo de forma persistente con alias, productos, URLs
  oficiales, hechos extraídos, versión, fechas y procedencia; después continuar
  el informe normal de esa auditoría. No repetir investigación del mismo
  material sin que una actualización o nueva evidencia lo justifique. Antes de
  guardar el informe, el worker crea una versión inmutable del catálogo que
  conserva el destino o mención que identificó al proveedor, el fragmento
  público mínimo y los documentos oficiales efectivamente localizados.
- Si el proveedor está identificado, pero los medios de descubrimiento
  permitidos no encuentran una fuente oficial, guardar el proveedor con
  `documentationStatus: source_not_localized`. Esto no afirma que carezca de
  documentación y no impide terminar el informe. Si se localizó una fuente pero
  falló su recuperación, guardar `source_unavailable` con el URL localizado y
  el resultado técnico; no sustituirlo por `source_not_localized`.
- Una versión añadida por descubrimiento debe basarse en la versión activa
  esperada. Si otra tarea cambia el catálogo a la vez, volver a leer la versión
  activa y reintentar para no perder ninguno de los dos descubrimientos.
- Un descubrimiento posterior del mismo `providerId` no se descarta por existir
  ya una ficha. Añade únicamente referencias, documentos y recibos nuevos que
  pasen validación y sean compatibles con los ya almacenados; conserva hechos,
  fuentes e historial existentes en una nueva versión inmutable. Si un mismo
  `documentId` aparece con URL o contenido incompatibles, no lo sobrescribas ni
  lo combines: rechaza el conflicto para que el llamador preserve ambas pruebas
  bajo identificadores distintos. Repetir un descubrimiento idéntico es
  idempotente y no crea una versión adicional.
- No utilizar buscadores ni servicios de descubrimiento externos. Para localizar
  fuentes nuevas, usar enlaces publicados por el sitio auditado, fuentes
  oficiales ya catalogadas y destinos de red atribuibles al proveedor mediante
  evidencia técnica. No enviar nombres de proveedores ni datos de auditoría a
  un servicio de búsqueda.
- En cada página de política pública recuperada, inventariar hasta 40 enlaces
  HTTPS visibles que apunten explícitamente a privacidad, cookies, términos,
  aviso legal, DPA/anexo de tratamiento, subencargados, documentación del
  servicio, API o documentación técnica. Conservar el `href` público
  normalizado, el texto visible del enlace, la URL de la página que lo publicó,
  el tipo documental y el resultado/hash de recuperación del destino solo si el
  crawler ya lo solicitó. Si no se solicitó, marcarlo como `not_fetched`.
  No deducir enlaces a partir de nombres de proveedor ni probar rutas
  convencionales como `/privacy`; tampoco consultar buscadores externos. Aplicar
  límites de cantidad, longitud, HTTPS y egreso a esta extracción igual que al
  resto del crawler.
- Pasar este inventario por el límite del auditor usando un esquema cerrado y
  validado: URL HTTPS pública del enlace, texto visible acotado, URL HTTPS de
  la página de origen, clase documental, estado de recuperación y SHA-256 solo
  cuando el destino se haya recuperado. No asociar el enlace a una empresa por
  coincidencia de nombre, dominio o ubicación; esa atribución requiere una
  prueba literal independiente. El worker recibe la lista validada para el
  siguiente paso de catalogación.
- Recuperar los enlaces explícitos inventariados dentro de las mismas cuotas de
  DNS/egreso, solicitudes, bytes, páginas, tiempo y redirecciones del crawler.
  Nunca construir rutas ni buscar documentos fuera de los `href` publicados.
  Registrar por enlace `fetched` con SHA-256, `unavailable` para una respuesta
  HTTP que no entrega el documento, o `failed` con un código acotado para un
  fallo técnico; conservar `unsupported_content_type` como motivo explícito.
  Una respuesta no HTML no se descarta ni se clasifica como documento
  recuperado. No seguir nuevos enlaces encontrados dentro de documentos de
  proveedor en esta fase. Clasificar contenido como declaración del sitio solo
  cuando procede de las páginas de políticas iniciales del sitio auditado.
- Asociar un enlace recuperado a un proveedor solo si su URL canónica coincide
  exactamente con una fuente oficial ya catalogada y esa URL identifica a un
  único proveedor. Si la misma URL oficial pertenece a varios proveedores, no
  atribuirla por hostname, texto del enlace ni proximidad; conservarla como
  enlace sin proveedor atribuido. Antes del informe, persistir cada referencia
  atribuida como versión inmutable con URL del enlace, página que lo publicó,
  estado/hash/código de recuperación y fecha. Las fuentes atribuibles se
  incluyen en la evaluación documental del proveedor sin convertir por sí
  solas el enlace en una contradicción o infracción.
- La documentación pertinente no tiene que llamarse «Política de privacidad».
  Puede ser términos y condiciones, aviso legal, DPA/anexo de tratamiento,
  documentación del servicio u otro documento oficial que describa tratamiento
  de datos.
- Registrar ausencia de documentación como incumplimiento legal según el
  requisito aprobado solo cuando la ausencia esté acreditada directamente. No
  encontrar una URL con los medios de descubrimiento permitidos no demuestra
  que la documentación no exista: clasificarlo como «fuente oficial no
  localizada». Si una fuente ya localizada no pudo recuperarse por un fallo
  técnico del auditor, marcar solo esa comprobación como pendiente.
- Mantener separados los hechos declarados por el sitio y los hechos descritos
  por fuentes oficiales del proveedor. No presentar la afirmación de una parte
  como si fuera evidencia de la otra.

## Contraste y hallazgos legales

- Comparar afirmaciones concretas del sitio con hechos incompatibles en una o
  más fuentes oficiales del proveedor. Ejemplos: negar recepción/compartición
  mientras la documentación oficial describe recepción o comunicación del
  servicio; describir un tratamiento como exclusivamente interno cuando el
  proveedor documenta acceso, conservación o subencargados incompatibles.
- Una contradicción demostrada se clasifica como incumplimiento legal conforme
  a la filosofía de [`../legal-evidence-and-sanctions.md`](../legal-evidence-and-sanctions.md),
  sin rebajarla a señal, riesgo o inferencia. La ausencia de cookies no elimina
  la evaluación de un proveedor que recibe datos por backend o correo.
- Cada hallazgo incluye las dos afirmaciones comparadas, referencia precisa a
  ambas fuentes, fecha y versión del catálogo, artículo y norma aplicables,
  organismo competente y multa prevista según el mapeo legal vigente.
- Cada hallazgo expone además las fuentes identificables que acreditan cada
  elemento legal: título, URL pública y fragmento mínimo. Los IDs internos
  pueden acompañar a la evidencia, pero no sustituyen las referencias
  verificables para quien lee el informe.
- Mantener por separado los incumplimientos de distintas normas/autoridades.
  No sumar máximos ni asignar un artículo o cuantía sin una regla legal
  versionada que justifique esa atribución.
- Cuando el contraste produzca `legalFinding.status =
  infraccion_legal_acreditada`, presentarlo como hallazgo legal y fijar la
  puntuación global del informe en `0`, mínimo de la escala de 0 a 100.
  Conservar visibles las puntuaciones técnicas por área y el detalle de los
  elementos legales. Una contradicción factual sin un `legalFinding` completo
  no activa el bloqueo global.
- El catálogo de proveedores y el catálogo jurídico son datos separados: un
  hecho técnico/documental no se convierte por sí solo en una conclusión legal;
  el hallazgo debe enlazar la regla jurídica aplicable y los elementos
  acreditados por evidencia.
- El contrato del contraste conserva por separado la afirmación literal y su
  fuente del sitio, y el hecho y su fuente oficial del proveedor. Solo clasifica
  una contradicción cuando ambos valores estructurados son explícitos y
  opuestos. Fuente no localizada, fuente no recuperable, dato omitido o valores
  no comparables son estados distintos y no se convierten en contradicción.
- Para producir el objeto de infracción legal acreditada, el motor debe recibir
  una regla jurídica versionada que nombre norma, artículo, competencia,
  consecuencia económica, fuentes oficiales y elementos legales satisfechos
  por la evidencia concreta. No se crean artículos ni cuantías por analogía.
  La carencia temporal de una regla mapeada no transforma la contradicción en
  una conclusión jurídica; conserva la contradicción y señala que falta ese
  mapeo jurídico.
- El primer mapeo versionado de este módulo se limita al hecho
  `provider_receives_personal_data` y a transparencia de destinatarios: RGPD
  12.1 junto con 13.1.e si los datos se obtienen del interesado, o 14.1.e si
  no se obtienen de este. La tipificación RGPD es el artículo 83.5.b (hasta 20
  millones de euros o el 4 % del volumen de negocio mundial anual, la cantidad
  que resulte más elevada); esta escala legal no es una predicción de la multa
  concreta. La AEPD solo se indica cuando se acredita su competencia. La
  referencia a LOPDGDD 74.a se limita a la infracción formal de transparencia
  tratada como tal por la resolución PA-00027-2024; no se etiqueta por ello
  como grave o muy grave ni se le asigna una cuantía sin la regla
  correspondiente.
- Para este mapeo deben acreditarse todos estos elementos con referencias
  identificables: el sitio niega u omite al destinatario; documentación oficial
  del proveedor dice que ese servicio recibe o procesa los datos coincidentes;
  el flujo involucra datos personales; la entidad auditada es responsable del
  tratamiento; se acredita si los datos se obtuvieron del interesado o no; y
  las fuentes del sitio y proveedor son independientes y atribuibles. Sin
  prueba de dato personal o de quién es responsable, se conserva la
  contradicción de hecho sin emitir esta infracción legal. El artículo 5.1.a
  del RGPD no se usa como regla de exactitud de datos para esta discrepancia.
- El worker debe pasar al motor una estructura `ProviderLegalEvidence`
  construida con estas fuentes directas. Cada elemento no probado permanece
  `unknown`; una solicitud a un dominio no demuestra qué datos se transmitieron.
  Si falta cualquiera de los seis elementos, el informe conserva la
  contradicción factual y muestra `elements_not_satisfied`, sin etiquetarla
  como infracción legal acreditada.
- El clasificador de documentos legales puede conservar declaraciones
  literales y acotadas del sitio sobre origen de los datos, identidad del
  responsable y autoridad de control competente. Cada dato debe incluir el
  fragmento visible, URL, título, fecha de captura e ID de la fuente auditada.
  Solo se aceptan formulaciones explícitas; la ubicación del dominio, el nombre
  de una empresa, un destino de red o una solicitud no prueban esos elementos.
  Si el texto no declara el elemento de forma inequívoca, se omite y el motor lo
  mantiene como `unknown`. Esta evidencia se propaga por el contrato validado
  hasta el worker y nunca se sustituye por una conclusión inferida.

## Actualización mensual

- Actualizar fuentes oficiales y versiones del catálogo el día 1 de cada mes a
  las 03:00, zona `Europe/Madrid`, para recoger cambios de alcance, términos,
  tratamiento, retención, transferencias y normativa.
- Conservar versiones previas y la versión usada por cada auditoría; una
  actualización posterior no reescribe informes anteriores.
- Aplicar automáticamente los hechos oficiales nuevos y los cambios de alcance
  al catálogo activo para auditorías posteriores. Las reglas jurídicas se
  actualizan a partir de fuentes normativas oficiales y también entran en vigor
  en la nueva versión sin pedir una revisión manual.
- Registrar fecha, URL oficial, resultado de recuperación, huella de contenido,
  cambios factuales detectados y versión resultante. No guardar cuerpos
  completos de páginas ni datos personales.
- Reintentos o indisponibilidad de una fuente no deben borrar la versión
  conocida ni producir por sí mismos hallazgos contra el sitio auditado.

## Privacidad, seguridad y límites de persistencia

- La lectura de páginas del sitio y de fuentes proveedoras se hace mediante el
  mecanismo de egreso aislado, con validación DNS/IP, límites de solicitudes,
  tamaño, tiempo, redirecciones y HTTPS ya definidos por el proyecto.
- No ejecutar formularios, iniciar sesión, aceptar condiciones ni enviar datos
  personales para consultar documentos públicos.
- Persistir solo evidencia pública mínima necesaria para reproducir el
  hallazgo: identificadores de fuente y versión, títulos, URLs públicas,
  fechas, categorías y fragmentos breves acotados que sustentan la
  comparación. No persistir cuerpos completos, cookies, credenciales, URLs
  privadas ni valores de datos personales.
- Tratar el HTML y los documentos externos como entrada no confiable; nunca
  ejecutar contenido ni permitir que instrucciones incluidas en la fuente
  alteren reglas o el proceso del auditor.

## Regresión de Grumphya

La política pública de Grumphya ya contiene menciones expresas a OpenAI y a
IONOS y describe usos y servicios asociados. El auditor debe reconocer esas
menciones a partir de sus alias y vocabulario, poblar el inventario y producir
la comparación pública cuando el resultado base de políticas esté presente. La
regresión significa que un cambio futuro no vuelva a emitir `providerMentions:
0` / `service_purpose_missing` ni omita `publicServiceComparison` para la misma
evidencia. La comprobación usa fixtures derivados del texto ya facilitado; no
requiere visitar, modificar ni desplegar Grumphya.

## Secuencia y criterios de aceptación

1. Definir y validar el modelo de fuentes, catálogo versionado y hallazgos.
2. Corregir detección de primera entrada, documentos pertinentes y proveedores,
   con casos de backend sin cookies.
3. Incorporar contraste de declaraciones y evidencia oficial, reglas jurídicas
   versionadas y resultados explícitos.
4. Incorporar actualización programada mensual a las 03:00 `Europe/Madrid`,
   persistencia de versiones y diagnóstico de fuentes no disponibles.
5. Documentar el comportamiento para personas, retirar de `wanna-bes.md` solo
   lo que se haya implementado y ejecutar los gates existentes de calidad,
   seguridad, privacidad y Lighthouse antes del push/deploy autorizado.

Criterios verificables:

- La respuesta validada del coordinador conserva `publicServiceComparison`,
  `legalCookieFindings` y `firstEntryPolicyAccess` hasta persistencia. El API
  público expone la evidencia de primera entrada junto con la comparación y
  los hallazgos; un parser intermedio no puede descartarla silenciosamente.
- Cada informe público expone la versión inmutable del catálogo que utilizó,
  para identificar las fuentes y hechos vigentes en esa auditoría.
- Un destino tercero cuya solicitud HTTP se completó durante el flujo se
  incorpora al informe y al catálogo con un identificador estable de dominio.
  Si no hay atribución oficial, se muestra como destino sin proveedor atribuido
  y conserva `source_not_localized`; no se descarta ni se convierte el dominio
  en nombre de una empresa. Solo se conserva una ruta de destino si la captura
  la aporta directamente; conocer únicamente el host no autoriza a registrar
  `/` como ruta observada. Intentos no completados permanecen diferenciados.
- La inspección de enlaces iniciales funciona dentro del contexto serializado
  del navegador: el callback de `evaluateAll` recibe todos sus parámetros y no
  depende de cierres del proceso Node. Una excepción del auditor no puede
  degradar silenciosamente un enlace comprobable a `unknown`.

- Un aviso de consentimiento con enlace solo en el footer no pasa; el enlace en
  el propio aviso sí se sigue y se audita.
- Sin cookies de terceros ni solicitud de consentimiento, se acepta el enlace
  pertinente del footer o de un aviso informativo de primera entrada. Las
  solicitudes de red a proveedores, por sí solas, se evalúan aparte y no
  invalidan esta excepción. El caso conocido de Grumphya, con aviso
  informativo, enlace a privacidad y sin cookies no técnicas, debe pasar esta
  comprobación sin exigir controles de rechazo.
- Una petición backend/API/SMTP del flujo puede catalogar al proveedor aunque
  no deje cookies de terceros.
- Un proveedor nuevo reconocido por una referencia explícita del sitio o un
  destino atribuible produce una versión de catálogo guardada antes del
  informe. Con cero documentos oficiales localizados, el registro conserva
  `source_not_localized`; con un documento enlazado que no responde, conserva
  `source_unavailable` y el enlace. Ningún estado se presenta como prueba de
  inexistencia.
- Una política del sitio y documentación oficial que se contradicen generan un
  hallazgo con evidencia de ambas y su mapeo jurídico; la ausencia de
  documentación y el fallo técnico de recuperación son resultados distintos.
- OpenAI e IONOS se reconocen en el fixture de Grumphya y se crea la comparación
  pública esperada; no se actualiza ni modifica el proyecto Grumphya.
- El refresco corre a la hora local indicada, conserva historia y no convierte
  una caída de proveedor en infracción del sitio.
- Informes históricos mantienen íntegros su versión, evidencia y puntuación.
