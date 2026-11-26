# Features

Este documento separa capacidades ya disponibles de los siguientes incrementos. El estado operativo vigente está en [README.md](README.md).

## F1. Consultar informes públicos

Una persona introduce una URL HTTPS pública y consulta el informe asociado a esa URL. La consulta conserva la ruta y la query, elimina el fragmento, y rechaza credenciales, IP literal, puertos alternativos y esquemas distintos de HTTPS. Los perfiles históricos conservan sus rutas originales; los trabajos nuevos usan `domain-v5` y auditan únicamente la ruta solicitada.

### Perfil vigente: auditoría de URL completa

El buscador público aceptará solo una URL `https://` completa, incluida su ruta
y query. No convertirá dominios sin esquema ni aceptará URLs HTTP. El fragmento
se elimina antes de consultar o auditar. Se audita esa URL
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
Cada deploy autorizado de Desarrollo Seguro avanza un epoch global de
admisión. Los trabajos encolados antes del epoch no consumen ni la caché de una
hora ni el cooldown de 24 horas para ninguna URL, aunque terminen después del
deploy. Así quien pruebe producción puede solicitar un informe generado por un
trabajo nuevo. Los informes históricos no se borran ni se modifican y no se
encolan análisis automáticamente; los límites por minuto, de cola y de un
trabajo activo por hostname siguen vigentes.

La URL completa se propaga por admisión, job temporal, transporte/worker,
perfil y validación del informe. Rendimiento usa mediciones propias tipo
Lighthouse para móvil y escritorio, sin librerías externas ni atribución de
puntuación oficial de Lighthouse. Móvil usa viewport 375×812, ralentización CPU 4× y red con RTT
150 ms, bajada 1,6 Mbps y subida 750 Kbps. Escritorio usa viewport 1365×768
sin throttling. La puntuación combina FCP (15 %), LCP (25 %), CLS (20 %), TBT
(20 %), TTFB (15 %) y bytes transferidos (5 %). Cada métrica recibe 100 en el
umbral bueno y 0 en el malo, con interpolación lineal entre ambos: FCP 1,8/3 s;
LCP 2,5/4 s; CLS 0,1/0,25; TBT 200/600 ms; TTFB 0,8/1,8 s; transferencia
1,6/4 MB. Si falta una métrica requerida, el perfil queda sin puntuación y se
indica la comprobación incompleta; la ausencia de medición no se convierte en
un valor cero.

Las cargas del navegador incluyen los recursos de terceros que la página
solicite con GET/HEAD. Salen por el proxy por análisis, con DNS fijado a IPv4
pública, solo puertos 80/443 y los límites de tiempo, solicitudes y bytes ya
definidos para el navegador. No se envían formularios ni se ejecutan acciones
de escritura para medir rendimiento.

**Criterios:** una URL con ruta y query conserva ambos en el alcance y el
informe; el fragmento no aparece en solicitudes ni persistencia; una URL con
credenciales, esquema distinto de HTTPS, host no público o destino no permitido se
rechaza; la consulta no inspecciona otras rutas. Los datos temporales de cola
se eliminan al terminar el job.

**Disponible:** API `GET` de estado e informe y `POST` explícito para solicitar un análisis; límites antiabuso por minuto, capacidad compartida PostgreSQL y proyección que excluye evidencia interna. La consulta `GET` no resuelve hostnames ni encola trabajos. La solicitud `POST` requiere confirmación de autorización y guarda una admisión `on_demand` de forma transaccional. Si se encola, el portal consulta el estado cada cinco segundos, hasta 15 minutos mientras haya trabajo activo, y presenta el informe nuevo cuando queda guardado. Si falla la admisión o no aparece un trabajo activo ni un informe nuevo, detiene el sondeo y permite reintentar. El runtime real está desplegado; el 20 de noviembre de 2026 se verificó una renovación periódica que produjo un informe nuevo y actualizó la certificación.

**Corrección de persistencia `domain-v5`:** el validador SQL de resultados debe admitir el perfil `domain-v5` en los mismos puntos de allowlist que `domain-v4`, conservando la validación acotada de controles, métodos, rutas y evidencia. El control `DS-QUAL-02` debe admitir y validar las 14 métricas móvil/escritorio que requiere el perfil, con los mismos límites enteros seguros del parser TypeScript; un resultado `pass` requiere el conjunto completo. La migración debe extender de forma robusta definiciones históricas que puedan contener entradas duplicadas; su comprobación no puede limitarse a encontrar `domain-v5` en cualquier parte de la función. La regresión PostgreSQL debe ejecutar la persistencia real de un informe solicitado `domain-v5` con métricas completas y volver a leerlas. El job no se considera completado si se generó una observación pero el informe fue rechazado al guardarse.

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
