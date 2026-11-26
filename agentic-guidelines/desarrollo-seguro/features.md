# Features

Este documento separa capacidades ya disponibles de los siguientes incrementos. El estado operativo vigente está en [README.md](README.md).

## F1. Consultar informes públicos

Una persona introduce una dirección web pública con o sin esquema y consulta el informe asociado. Si falta el esquema, el portal añade HTTPS; los esquemas explícitos se conservan y se rechazan los que no sean HTTPS. La consulta conserva la ruta y la query, elimina el fragmento y rechaza credenciales, IP literal y puertos alternativos. Los perfiles históricos conservan sus rutas originales; los trabajos nuevos usan `domain-v5` y auditan únicamente la ruta solicitada.

### Perfil vigente: auditoría de URL completa

El buscador público aceptará una dirección web completa o una URL `https://`,
incluidas su ruta y query. Si no se ha escrito un esquema, añadirá `https://`;
si ya hay uno, conservará lo escrito y la validación existente rechazará
esquemas distintos de HTTPS. El fragmento se elimina antes de consultar o
auditar. Se audita esa URL
exacta en todos los bloques del informe; no se reemplaza por la portada ni por
las rutas fijas existentes. La identidad, límites antiabuso y validación de
destino siguen aplicándose al hostname, con la protección SSRF vigente. La query
se persiste en el informe público y, mientras el trabajo espera o se ejecuta,
en la cola; al completar o fallar el trabajo se elimina de los datos temporales
de cola. No se envían credenciales embebidas ni fragmentos. Solo se admite el
puerto HTTPS por defecto; se rechazan puertos explícitos alternativos.
El límite antiabuso de 24 horas se aplica a la URL completa normalizada
(hostname, ruta y query), sin fragmento. Una solicitud programada o una
auditoría de otra ruta/query no consume ese límite. Para evitar ejecuciones
simultáneas abusivas, solo puede haber un análisis solicitado activo por
hostname; una segunda URL espera a que termine ese trabajo y no lo reutiliza.
El campo de búsqueda muestra como ejemplo un dominio genérico sin esquema,
ruta ni parámetros; no promueve introducir queries.
Cada deploy autorizado de Desarrollo Seguro avanza un epoch global de
admisión. Los trabajos encolados antes del epoch no consumen ni la caché de una
hora ni el cooldown de 24 horas para ninguna URL, aunque terminen después del
deploy. Así quien pruebe producción puede solicitar un informe generado por un
trabajo nuevo. Los informes históricos no se borran ni se modifican y no se
encolan análisis automáticamente; los límites por minuto, de cola y de un
trabajo activo por hostname siguen vigentes.

Al consultar una URL sin informe previo, la acción de consulta también registra
automáticamente un análisis: no se pide una confirmación adicional ni una
segunda pulsación para iniciarlo. Una URL que ya tiene informe conserva la
consulta de solo lectura y los controles explícitos para solicitar una nueva
revisión. Después de registrar o detectar un trabajo activo, el portal consulta
su estado automáticamente y muestra el informe nuevo sin recargar la página.
Mientras no hay informe disponible se presenta un único mensaje breve de
progreso, sin repetir la misma explicación en dos bloques.

Los cuatro aspectos del informe —Ética, Privacidad, Seguridad y Rendimiento—
mantienen el resultado disponible y muestran un spinner solo mientras sus
comprobaciones estén pendientes o en curso. El estado de cada aspecto procede de progreso real
persistido por el trabajo; no se simula progreso a partir del tiempo
transcurrido.

El contrato temporal `public-audit-progress-v1` contiene para cada aspecto
`pending`, `running` o `complete`, sin porcentajes ni datos del sitio. Se
almacena en `ds_scan_jobs` mientras el job está activo y la API lo expone solo
en el estado del mismo hostname y URL consultados. Las transiciones son
monótonas: `pending → running → complete`. El worker publica: Seguridad tras
las sondas HTTP/TLS/DNS; Privacidad tras la observación de privacidad;
Rendimiento tras las mediciones de móvil y escritorio; Ética tras combinar las
comprobaciones finales con la comparación documental/de servicios. El informe
completo sigue siendo inmutable y solo se publica al terminar. El portal
conserva el último informe disponible y muestra al lado los aspectos que se
están actualizando; sin informe previo, presenta los cuatro estados por
separado hasta que esté disponible el resultado final. Al acabar o fallar el
job, se borra este estado temporal.

La URL completa se propaga por admisión, job temporal, transporte/worker,
perfil y validación del informe. La medición móvil debe seguir el perfil
predeterminado de Lighthouse en modo `simulate`, no emular directamente el
tráfico con `Network.emulateNetworkConditions` y CPU throttling de DevTools.
Debe ejecutarse en el navegador aislado del auditor, sobre la URL exacta y con
el proxy de salida seguro. Solo se permiten solicitudes GET/HEAD; se bloquean
WebSockets y no se ejecutan acciones de escritura. El motor recibe únicamente
la categoría Performance. Solo se conservan las métricas numéricas aprobadas y
la puntuación, nunca el informe Lighthouse completo, el contenido ni recursos
capturados. El contenedor de navegador dispone de hasta 1 GiB de memoria y 1 CPU.
La ruta Lighthouse debe usar el ejecutable `chrome-headless-shell` que Playwright
instala junto al Chromium fijado, no el binario Chrome normal, y debe usar
`--no-sandbox` dentro del contenedor efímero. Chromium opera como usuario sin
privilegios, con capacidades eliminadas y salida a red forzada por el proxy
seguro. El smoke de la imagen debe arrancar el mismo binario mediante Puppeteer.
Ante errores se incluye en el diagnóstico interno solo la fase y clase
normalizada, sin mensaje, URL ni datos de la página. El coordinador que invoca
el contenedor debe conservar esos dos campos en su log operativo; los valida
con allowlist y no los copia a la evidencia pública.

El perfil móvil usa las métricas FCP (10 %), Speed Index (10 %), LCP (25 %),
TBT (30 %) y CLS (25 %) y la puntuación del modo `simulate` de una versión
fijada de Lighthouse. No se sustituye la puntuación ni las métricas de ese
perfil con aproximaciones propias. TTFB y bytes transferidos son diagnósticos.
El perfil de escritorio conserva Chromium y la rúbrica existente: viewport
1365×768, sin throttling. La extracción valida los cinco valores móviles y la
puntuación; si falta cualquiera, el perfil queda sin nota y se informa como
incompleto, nunca como cero. La versión del motor queda identificada en la
evidencia.

El perfil `domain-v5` mantiene también las comprobaciones públicas de
transparencia documental y comparación de servicios externos del perfil
`domain-v4`, aplicadas a la URL exacta solicitada. Debe producir en cada
informe una evaluación `public-policy-v1`, la comparación pública
`public-service-comparison-v1` y la evaluación ética `domain-ethics-v6` con
ocho criterios. La respuesta conserva los documentos descubiertos y las
declaraciones necesarias para comparar servicios observados con la política y
el catálogo oficial. Un fallo técnico real del auditor conserva `unknown` y
su diagnóstico; estos bloques no se omiten por usar una ruta exacta en vez de
las rutas históricas del dominio.

El portal público debe aceptar la comparación de servicios y la evaluación
ética v6 de `domain-v5-network-adapter-2`, así como las combinaciones v6 ya
publicadas por los adaptadores `domain-v4-network-adapter-5`, `-6` y `-7`.
Un informe válido devuelto por la API no puede convertirse en un error de
consulta por usar la versión vigente del perfil.

**Criterios:** el smoke de despliegue obtiene un informe `domain-v5` con
evaluación pública de políticas y comparación de servicios presentes, ocho
criterios éticos evaluados y métricas completas de rendimiento móvil y
escritorio. El portal carga un informe `domain-v5-network-adapter-2` con
comparación de servicios y ética v6. Los tests cubren la propagación de esos bloques desde el executor
hasta el informe público, tanto con resultados conclusivos como con un error
verificable del auditor.

La consulta de una URL sin informe provoca una única solicitud autorizada y
presenta su resultado al terminar sin una recarga; una consulta de una URL con
informe sigue siendo de solo lectura. El estado sin informe no repite el mismo
texto de progreso. Las comprobaciones cubren las dos rutas. Para progreso
parcial, el estado de cada uno de los cuatro aspectos debe provenir del job y
actualizarse al completar sus comprobaciones; no se aceptan spinners
decorativos ni estados calculados solo por tiempo.

Las cargas del navegador incluyen los recursos de terceros que la página
solicite con GET/HEAD. Salen por el proxy por análisis, con DNS fijado a IPv4
pública, solo puertos 80/443 y los límites de tiempo, solicitudes y bytes ya
definidos para el navegador. No se envían formularios ni se ejecutan acciones
de escritura para medir rendimiento.

La observación de privacidad y la medición de rendimiento tienen plazos
independientes de hasta 120 segundos cada una. El plazo de privacidad no se
comparte ni se consume antes de iniciar el perfil móvil o escritorio. El
timeout del contenedor y el del coordinador cubren ambas ventanas más el
escaneo base, el inicio y la limpieza del runtime; un perfil no debe quedar
incompleto solo porque la observación anterior usó su propio presupuesto.
El estado final de `DS-QUAL-02` se calcula después de combinar la evidencia
HTTP inicial con las métricas de Chromium requeridas. El estado provisional
`unknown` por ausencia temporal de métricas no puede sobrevivir si ambos
perfiles se completaron; una respuesta lenta sigue siendo `fail`, y la falta
de cualquier dato requerido sigue siendo `unknown`.

Un timeout al esperar `networkidle` no descarta por sí solo las métricas que
Chromium ya haya medido: se mantiene el límite de observación y se evalúan los
datos disponibles. Si un perfil queda `unknown`, el worker registra un
diagnóstico estructurado con el perfil y los nombres de métricas ausentes, sin
URL, hostname, texto del sitio ni mensajes de excepción. El resumen ético de
Rendimiento debe describir la falta de métricas de perfil y no afirmar que
faltan tiempo o tamaño HTTP inicial cuando esos valores constan en la evidencia.
Las métricas parciales permanecen dentro del intercambio entre el navegador
aislado y el coordinador; no se guardan ni se publican como resultado del perfil.
Para TBT se busca primero la ventana de cinco segundos sin tareas largas y con
un máximo de dos solicitudes activas. Si esa ventana no aparece antes del fin
de la observación acotada, se suman las porciones bloqueantes de las tareas
observadas desde FCP hasta ese límite; la ausencia de quietud de red no anula
por sí sola tareas que sí fueron medidas. El resumen de `DS-QUAL-02` nombra
el perfil y los datos que faltan, y refleja el estado real del control.

**Criterios:** una URL con ruta y query conserva ambos en el alcance y el
informe; el fragmento no aparece en solicitudes ni persistencia; una URL con
credenciales, esquema distinto de HTTPS, host no público o destino no permitido se
rechaza; la consulta no inspecciona otras rutas. Los datos temporales de cola
se eliminan al terminar el job.

**Criterios de plazos de observación:** privacidad y rendimiento reciben
señales de cancelación separadas y cada una conserva su límite de 120 segundos.
El límite exterior permite terminar las dos observaciones secuenciales y su
limpieza. Una prueba de regresión debe demostrar que agotar el plazo de
privacidad no presenta a rendimiento una señal ya abortada.
Una regresión adicional debe empezar con `DS-QUAL-02` provisionalmente
`unknown`, aportar después respuesta HTTP válida y las métricas completas, y
comprobar que la nueva sanitización produce `pass`; el umbral de respuesta
superior a 2.500 ms conserva `fail`.

**Disponible:** API `GET` de estado e informe y `POST` para solicitar una revisión nueva; límites antiabuso por minuto, capacidad compartida PostgreSQL y proyección que excluye evidencia interna. La consulta GET no encola trabajos cuando ya existe un informe; cuando no hay informe, la acción del buscador solicita una auditoría. La revisión nueva de una URL ya auditada requiere confirmar autorización. El portal consulta el estado cada cinco segundos, hasta 15 minutos mientras haya trabajo activo, y presenta el informe nuevo cuando queda guardado. Si falla la admisión o no aparece un trabajo activo ni un informe nuevo, detiene el sondeo y permite reintentar. El estado temporal incluye progreso real y monotónico por aspecto, persistido en el job y expuesto mientras siga activo. El runtime real está desplegado; el 20 de noviembre de 2026 se verificó una renovación periódica que produjo un informe nuevo y actualizó la certificación.

**Corrección de persistencia `domain-v5`:** el validador SQL de resultados debe admitir el perfil `domain-v5` en los mismos puntos de allowlist que `domain-v4`, conservando la validación acotada de controles, métodos, rutas y evidencia. El control `DS-QUAL-02` admite y valida las métricas móvil/escritorio del perfil, con los mismos límites enteros seguros del parser TypeScript; un resultado `pass` requiere el conjunto completo. La migración debe extender de forma robusta definiciones históricas que puedan contener entradas duplicadas; su comprobación no puede limitarse a encontrar `domain-v5` en cualquier parte de la función. La regresión PostgreSQL debe ejecutar la persistencia real de un informe solicitado `domain-v5` con métricas completas y volver a leerlas. El job no se considera completado si se generó una observación pero el informe fue rechazado al guardarse.

**Criterios:** errores y ausencia de informe no muestran un resultado inventado ni reutilizan silenciosamente un informe anterior; respuestas llevan `Cache-Control: no-store`; el estado `not_scanned` indica que no existe observación.

**Corrección del contrato de observación Chromium:** los resúmenes que `domain-v5` deriva de observaciones de cookies y solicitudes deben coincidir exactamente con los allowlists SQL de persistencia. La migración cubre `DS-PRIV-05` y `DS-PRIV-06` para informes `domain-v4` y `domain-v5` sin aflojar la validación de texto/evidencia. La regresión PostgreSQL persiste un informe v5 con ambas observaciones completas y comprueba su lectura pública.

Para Grumphya, `grumphya.com` y `www.grumphya.com` comparten la identidad del informe solo cuando un informe reciente observa una cadena completa y validada de redirección HTTP permanente 301/308 entre ambos. El escáner continúa la redirección con las mismas protecciones DNS, TLS, rutas y salida; no transforma el hostname por texto. La respuesta pública conserva el hostname solicitado y el salto observado. El estado del alias apunta al informe vigente del destino y muestra la evidencia de redirección por separado. Sin esa evidencia permanente, los hostnames permanecen separados.

En los análisis públicos, las sondas siguen además redirects entre el hostname
solicitado y su alias literal `www.` para leer la página canónica, sin fusionar
informes ni historiales. Solo se permite el par exacto y se mantienen los
límites de transporte y alcance definidos en
[`canonical-www-probe-redirects.md`](canonical-www-probe-redirects.md).

## F2. Informes y evidencia

Un informe identifica hostname, perfil, rutas cubiertas, métodos, resultados, fecha UTC, punto de observación y límites. `same_vps` indica que la muestra procede del mismo VPS donde se ejecuta el servicio; no implica una observación independiente desde Internet.

**Criterios:** solo se publican campos permitidos; el contenido libre se redacta o sustituye por texto controlado; cada control incluye limitaciones; ningún `pass` se presenta como certificación, cumplimiento legal o ausencia de vulnerabilidades.

## F5. Certificación beta y sello verificable

La migración 023 conserva una certificación por dominio y política. Los estados
`pending`, `active` y `suspended` se derivan al completar un informe; los
eventos de transición quedan registrados sin guardar contenido sensible.
El sello se emite para una identidad de dominio con certificación `active` y
un informe certificado vigente. El token, con vencimiento de 30 días, queda
asociado a la identidad canónica del dominio; no queda fijado para siempre al
UUID que existía al emitirlo. En cada verificación, el widget obtiene el
`certifiedReportId` vigente desde el estado público y la API comprueba que ese
UUID siga siendo el informe certificado, fresco y activo. El widget puede
seguir visible durante una revisión (`updating`) mientras el certificado
anterior siga fresco; la API vuelve a comprobar su vigencia. Por tanto, una
renovación elegible actualiza el informe que verifica el mismo sello; una
suspensión, caducidad del informe, revocación o expiración del token lo oculta.
La evidencia incompleta mantiene una certificación activa en revisión; un
incumplimiento bloqueante la suspende y un informe elegible posterior la
reactiva.

**Criterios:** no se puede emitir un sello para una identidad sin informe
certificado vigente; un informe pendiente, bloqueado o histórico nunca se
verifica como certificado. Un sello suspendido deja de verificarse aunque su
token siga existiendo. Una renovación elegible mueve la verificación al nuevo
informe sin modificar el snippet ni emitir otro token. El sello también deja
de verificarse si el informe, la certificación o el token caducan; la ficha
pública muestra el estado y la fecha de última evaluación.
Para los dos hostnames autorizados de Grumphya, emisión y verificación resuelven
el hostname canónico con la evidencia reciente 301/308 y ligan el sello al
informe certificado vigente de ese destino en cada petición. El widget resuelve
`certifiedReportId` mediante `GET /domains/:hostname/status`; el `reportId`
estático del embed es opcional y no autoritativo. Resuelve estados `fresh` y
`updating`; cualquier otro estado oculta el sello. La verificación acepta solo
el UUID que actualmente señala la certificación activa, y responde con ese
UUID y `canonicalHostname`; los fallos devuelven diagnósticos categóricos sin
token. La allowlist de `Origin` sigue independiente de la identidad del
informe.

El widget público puede incrustarse desde `grumphya.com`, incluso cuando el
documento consumidor aplica COEP `require-corp`: únicamente la respuesta de
`/desarrollo-seguro/badge-widget.js` publica
`Cross-Origin-Resource-Policy: cross-origin`. No se relajan CSP, CORP ni CORS
para el resto del sitio o para scripts genéricos.

**Criterio adicional:** la petición del script devuelve HTTP 200 y la cabecera
CORP indicada; un navegador con COEP puede cargarlo y ejecutar la verificación.
El asset sigue con `Cache-Control: no-store` para que los cambios de widget
lleguen sin cambiar su URL.

**Presentación y verificación pública:** el enlace del footer es una insignia
compacta de aprobación con el logotipo aprobado de Desarrollo Seguro y texto
legible; sus estilos se mantienen en SCSS y se entregan con el widget sin
depender de CSS ni cambios del sitio Grumphya. La página de destino confirma
visualmente el estado del sello y su comprobación reciente, y muestra el
informe público relacionado: dominio, veredicto, puntuación/estado beta,
categorías evaluadas, fecha, alcance e identificador, además de un enlace a la
vista completa existente. Solo muestra resultados y enlace de informe cuando
la API confirma que el token no ha caducado ni se ha revocado y que el informe
es el certificado vigente. Los fallos muestran una explicación categórica y no
se quedan en estado pendiente. Token: fragmento de URL al abrir, cuerpo JSON
al verificar y nunca texto visible, telemetría ni URL de petición.

La tarjeta de estado de certificación beta en la ficha pública solo se muestra
para los clientes actuales `grumphya.com` y `desarrolloseguro.org`. Los
resultados de auditoría de dominios ajenos no muestran una certificación
pendiente, bloqueada o suspendida que no les corresponde.

**Criterio de presentación:** la tarjeta de estado puede aparecer para esos dos
hostnames y queda ausente para cualquier otro, incluso si la respuesta de API
incluye por compatibilidad un objeto `certification`.

El consumidor de Grumphya aplica `img-src 'self' blob:` y `connect-src
'self' https://desarrolloseguro.org`; por ello el widget debe incluir el SVG
aprobado como recurso `blob:` local creado desde el asset compilado. Los
módulos `.mjs` públicos se sirven con MIME `application/javascript` para que
Chromium y otros navegadores los acepten como módulos ES.

**Criterios adicionales:** el navegador carga el verificador sin errores MIME;
una verificación válida deja el estado pendiente y muestra el resultado
autorizado y el resumen del informe; un token inválido, vencido, revocado o una
API no disponible muestra un error y no publica resultado de aprobación. La
insignia visible contiene el logotipo y pasa contraste/reflow móvil; no hace
peticiones de recursos a Grumphya ni incorpora seguimiento externo.

## F6. Historial público y comparabilidad

**Incremento B-01 disponible:** el endpoint `GET /domains/:hostname/history`
devuelve hasta doce resúmenes de informes externos, ordenados por fecha. La
respuesta solo contiene identificadores UUID, perfil, fechas, veredicto,
puntuación provisional y estado de certificación. La ficha React muestra los
enlaces a cada informe y advierte que las puntuaciones solo son comparables
entre perfiles iguales.

**Estado de B:** además del historial, la Beta aplica la caché pública de una
hora, elimina fichas no certificadas tras 30 días de inactividad y conserva la
comparabilidad por perfil. El progreso se consulta mediante el estado de la
admisión; SSE es opcional y no forma parte de la aceptación de B.

## F3. Escaneo automatizado

El worker y el coordinador están en Compose; el coordinador crea un executor de red deshabilitada y un broker de salida acotado. La admisión compartida limita la cola a diez trabajos simultáneos en espera y una ejecución global, con máximo 1000 dominios `on_demand`. El límite por minuto permanece activo, junto con el cooldown de 24 horas por URL completa, la exclusión de trabajos activos simultáneos por hostname y la deduplicación de URL activas. Cada deploy autorizado avanza el epoch de admisión global para permitir renovar cualquier URL auditada, sin borrar informes ni iniciar trabajos por sí mismo. Un trabajo encolado antes del epoch no puede satisfacer esa renovación aunque complete después del deploy. Los trabajos `domain-v5` conservan la URL completa en PostgreSQL mientras esperan o se ejecutan; una vez terminal, la columna temporal se limpia. El workflow manual valida un informe `domain-v5` reciente de `grumphya.com`, incluidas las métricas de rendimiento por perfil. Si otra ruta del mismo hostname ocupa el slot, el smoke de deploy espera y vuelve a solicitar la URL objetivo; no interpreta la ausencia de un informe de esa ruta como un resultado reutilizable. No se hacen POST al sitio analizado, autenticación en esos sitios, fuzzing, fuerza bruta ni exploración arbitraria.

**Criterios:** cualquier fallo de cobertura, transporte o política deja el control como `unknown`/no evaluable; no se convierte en aprobado. El modelo de amenazas y los límites de confianza están en [scanner-safety.md](scanner-safety.md); el executor permanece apagado hasta demostrar allí los gates de red, aislamiento y evidencia.

## F4. Almacenamiento y operación

API, web, PostgreSQL, worker y coordinador se ejecutan en contenedores de Desarrollo Seguro con redes, volumen y secretos propios. El proxy público reenvía el dominio a la red de entrada exclusiva; API y PostgreSQL no publican puertos del host.

**Criterios:** la base no comparte tablas, volúmenes o credenciales con otros sistemas; detener o actualizar este stack no ejecuta cambios en otros proyectos; backup y restauración se prueban sobre una instancia aislada.

## Perfil reducido `transport-v1`

La migración 007 registra un perfil nuevo e inmutable, con alcance solo `/` y cobertura exacta de cinco comprobaciones: DNS, TLS, HTTP HEAD, HTTP GET y cabeceras HTTPS. Excluye privacidad y calidad porque aún no hay observadores para esos controles. Core, persistencia, API y portal reconocen la versión; el ensamblador fixture-only valida cobertura y veredicto. El executor de red convierte las señales en los cinco controles y puede ejecutarse en proceso hijo sin recibir lease ni entorno del coordinador; el recorrido hasta un informe público se probó contra PostgreSQL aislado con una respuesta fixture.

## Límite actual

El entrypoint worker (`pnpm --filter @desarrolloseguro/worker start`) compone el store PostgreSQL con rol `ds_worker`, procesador por lease, cliente del supervisor Unix y telemetría allowlisted. Usa polling serial, backoff limitado y parada por SIGINT/SIGTERM; requiere un secreto DB en fichero y propietario/grupo esperados para el socket. El supervisor tiene un entrypoint (`start:coordinator`) que enlaza servidor Unix y runner Docker, valida configuración y fija un socket Docker local explícito. Compose define ambos procesos de análisis; el coordinador es el único que monta el socket Docker y no tiene red propia. El worker solo comparte el socket Unix con él y pertenece al backend interno. Los schedulers separados ejecutan diariamente el purgado de informes de más de 90 días y la limpieza de informes públicos `on_demand` inactivos durante 30 días, además de encolar cada hora auditorías vencidas de certificaciones activas usando `ds_retention`; las funciones conservan informes certificados y dominios monitorizados. El observador fija DNS/IP validado, aplica TLS, HTTP→HTTPS y deriva evidencia de cabeceras; el executor limita sondas, intentos y bytes y reduce errores TLS a categorías seguras. El smoke post-deploy debe comprobar el firewall de egress, detectar una generación real de informe y rechazar resultados incompletos antes de declarar operativo el escáner. Ver [scanner-safety.md](scanner-safety.md) y [test-plan.md](test-plan.md).
