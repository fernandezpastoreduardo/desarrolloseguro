# Fase Solistos: privacidad observable y calidad ética web

> **Estado: requisitos v1 acordados.** La secuencia autoriza implementación por
> cambios pequeños y revisables; ningún análisis real se habilita hasta superar
> las puertas de aislamiento, seguridad y runtime de esta especificación.

## Propósito y momento

Solistos se ejecuta después del cierre de Beta y antes del MVP. Reconoce con
evidencia positiva los sitios que no cargan tecnologías de seguimiento, aunque
por ello no necesiten mostrar un panel de consentimiento. También identifica
patrones observables que perjudiquen privacidad, transparencia, seguridad,
accesibilidad o rendimiento, tanto en dominios certificados como en los demás.

El estado vigente del requisito aplazado está en la sección Solistos de
[`wanna-bes.md`](../../wanna-bes.md). La toma de requisitos v1 quedó cerrada
con las decisiones del desarrollador resumidas en esta especificación.

## Decisiones confirmadas

| Decisión | Requisito |
| --- | --- |
| Navegación | Analizar solo `/` del dominio solicitado, sin seguir enlaces internos. |
| Interacción | Usar un navegador aislado para observar la carga y probar aceptar, rechazar, controles por proveedor y persistencia tras recargar. |
| Contexto | Navegador en español y contexto de referencia España/EEE; el informe identificará ese contexto y no afirmará que represente otras regiones. |
| Scripts | Ejecutar scripts públicos y contactar recursos públicos de terceros con límites de red estrictos. La salida revela a los sitios contactados la IP de egreso del auditor. |
| Escrituras | Permitir solo las solicitudes de escritura necesarias para guardar una decisión de consentimiento o desactivar un proveedor. No enviar formularios ni realizar otras acciones del sitio. |
| Frecuencia | Ejecutar Solistos con cada análisis manual y periódico. |
| Evidencia positiva | Evaluar cookies, claves de local/session storage, nombres de bases IndexedDB, caches y solicitudes observadas; distinguir ausencia observada de cobertura incompleta. No guardar valores de almacenamiento. La ausencia de banner no es un incumplimiento. |
| Base de conocimiento | Datos locales versionados y revisados antes de actualizarse; sin consulta remota en cada análisis. Debe guardar procedencia, fecha de revisión y confianza de cada regla. |
| Volumen | Umbrales contextuales, publicados y diferenciados por tipo y redundancia; no comparar dominios entre sí. |
| Rechazo | Rechazar todo debe estar en el mismo nivel visible que aceptar todo y requerir el mismo número de acciones desde la primera vista. |
| Proveedores | Probar el control de cada proveedor relevante con señales conocidas de que declara o aplica interés legítimo; comprobar si tras desactivarlo cesan cookies y solicitudes atribuibles. |
| Presentación pública | Enumerar nombres de cookies, proveedores y dominios observados; excluir valores de cookies y datos personales. |
| Resultado | Añadir Privacidad como dimensión independiente de 0–100, con cobertura y pesos publicados según impacto. Usar nota parcial cuando falten criterios, mostrando cuántos se evaluaron. |
| Hallazgos | Penalizar proporcionalmente a cantidad e impacto solo con evidencia confirmada y reproducible. La duda o falta de cobertura queda como indicio/`unknown`, sin penalización afirmativa. |
| Certificación | Los nuevos hallazgos y la nota de Privacidad no conceden, bloquean ni suspenden el sello. |
| Otras categorías | Clasificar hallazgos de seguridad, transparencia, rendimiento y accesibilidad en sus categorías actuales; privacidad/consentimiento alimenta la nueva dimensión. |
| Automatización | Playwright 1.65.0 y Chromium fijado autorizados para el worker, sujetos a aislamiento, límites y gates del repositorio. |
| Hosts propios y terceros | El hostname solicitado y su alias `www.<hostname>` son propios; cualquier otro hostname, incluidos los demás subdominios, es tercero. Si se solicita `www`, también tratar el hostname raíz correspondiente como propio. Normalizar a minúsculas y quitar el punto DNS final antes de comparar. |
| Persistencia de privacidad en producción | El aprovisionamiento de producción debe conceder a `ds_worker` ejecución de `ds_complete_scan_with_privacy(...)`, revocar la función de finalización legacy que no guarda la evaluación, y probar ambos permisos con roles PostgreSQL reales. Así un informe válido y su nota de Privacidad se guardan en la misma transacción y con privilegio mínimo. |

## Límites de comportamiento

- Cada ejecución empieza con un contexto de navegador limpio y efímero. Se
  destruye al finalizar; no se reutilizan cookies, caché, almacenamiento,
  service workers ni credenciales entre dominios o ejecuciones.
- La prueba observa por separado la carga inicial, las opciones de aceptar y
  rechazar, el resultado de rechazar, la recarga y los controles individuales
  relevantes. Para comparar efectos se usan contextos limpios independientes;
  no se mezcla el resultado de aceptar con el de rechazar.
- Un proveedor es relevante para la comprobación individual cuando la interfaz
  observada o una regla local revisada le atribuye una señal de interés
  legítimo. Registrar lo declarado y lo observado por separado; no emitir una
  conclusión legal sobre la base jurídica.
- El análisis se limita al documento de inicio y a las solicitudes necesarias
  para renderizarlo o guardar la decisión de consentimiento. No navega a otras
  páginas, no inicia sesión, no completa formularios y no ejecuta compras,
  registros u otras mutaciones.
- El runtime del navegador no recibe secretos, credenciales, socket Docker ni
  montajes del host. Egress debe impedir loopback, redes privadas, link-local,
  metadatos, redes Docker, puertos distintos de 80/443 y destinos no públicos;
  resolver y validar cada destino y cada redirección. Los límites compartidos
  de peticiones, bytes, tiempo, CPU, memoria y proveedores deben quedar fijados
  en la política versionada antes de habilitar la función. El presupuesto
  agregado v1 es 120 segundos, 300 solicitudes HTTP(S), 20 MiB, 30 proveedores
  individuales y ocho contextos por análisis.
- Registrar intentos de solicitud de terceros incluso cuando el límite de
  método/alcance los bloquee. Diferenciar intento, conexión completada y
  respuesta observada; un intento abortado no acredita que se entregara dato.
- Si un presupuesto se agota, una regla no es concluyente o el navegador no
  puede observar un control, marcar la parte afectada `unknown`/`partial`, no
  inferir ausencia ni penalizarla.
- No persistir HTML, texto completo del sitio, capturas, trazas, HAR, cuerpos,
  valores de cookies, identificadores, IP de usuario ni datos de formularios.
  Persistir solo evidencia acotada y necesaria: nombres y dominios observados,
  proveedor/clasificación y procedencia de la regla, contadores, estado,
  acciones requeridas y metadatos temporales. Redactar rutas y parámetros
  sensibles.
- La nota no comparará un dominio con otros sitios. Cada umbral será una regla
  absoluta versionada, con fundamento, tipo de señal y explicación del impacto.

## Evidencia y nota

La nueva dimensión `Privacidad` debe valorar en una rúbrica versionada, como
mínimo:

1. Cookies, almacenamiento y solicitudes de seguimiento antes de una elección
   afirmativa.
2. Cantidad por tipo, propósito, proveedor y dominio, incluidos duplicados y
   redundancia según umbrales contextuales publicados.
3. Visibilidad y pasos necesarios para aceptar y rechazar en la primera vista.
4. Aplicación efectiva del rechazo y persistencia tras recargar `/`.
5. Señales de interés legítimo, lista de proveedores y eficacia de los
   controles individuales pertinentes.

La rúbrica publicará pesos por impacto y los criterios evaluables/desconocidos.
Las penalizaciones serán proporcionales y nunca se basarán solo en coincidencias
de baja confianza. Si no hay señales conocidas de seguimiento y la observación
es completa, la falta de un banner no reducirá la nota.

### Pesos aprobados para la versión 1

| Criterio | Peso aprobado | Qué puntúa |
| --- | ---: | --- |
| Actividad no esencial antes de elegir | 30 | Presencia y efecto de cookies, almacenamiento o solicitudes confirmadas en la carga inicial. |
| Exceso y redundancia | 10 | Solo la cantidad que supera umbrales contextuales absolutos por tipo/proveedor; no contar aquí el primer hallazgo de actividad previa. |
| Paridad de aceptar y rechazar | 20 | Visibilidad en primera capa y diferencia de acciones necesarias. |
| Eficacia del rechazo y persistencia | 20 | Si la elección detiene señales observables y se conserva tras recargar. |
| Control por proveedor e interés legítimo | 20 | Lista, fricción individual y si las señales atribuibles cesan después de desactivar cada control relevante. |
| **Total** | **100** | |

Fórmula v1: cada hallazgo confirmado descuenta 0,25 (bajo), 0,5 (medio) o 1
(alto) puntos absolutos dentro de su criterio, sumando hallazgos y limitando la
deducción al peso total de ese criterio. La nota normalizada conserva hasta dos
decimales para no borrar penalizaciones pequeñas. Evidencia de baja confianza queda `unknown` y descuenta
cero. `unknown` se excluye del denominador y se refleja en la cobertura;
`not_applicable` se muestra aparte y no reduce nota. La nota pública
se normaliza sobre criterios evaluables y siempre presenta evaluados,
desconocidos y no aplicables, por ejemplo `90/100 · 3/5 evaluados · 2 n/a`.
Los límites, severidades y factores de confianza deben publicarse en la tabla
de reglas de la versión antes de programar el evaluador.

Los hallazgos adicionales se proyectarán en seguridad, transparencia,
rendimiento y accesibilidad con sus límites de laboratorio. Un indicador
automático no afirmará conformidad legal, ausencia total de rastreo ni
conformidad WCAG.

## Criterios de aceptación

- Un caso completamente observado sin señales conocidas de seguimiento recibe
  evidencia positiva de privacidad; la ausencia de panel no genera fallo.
- Una cookie, clave de almacenamiento o solicitud clasificada como no esencial
  antes de elegir queda enumerada en el informe con evidencia reproducible y
  reduce la nota según la regla/peso aplicable.
- Una coincidencia ambigua, bloqueo técnico, destino no evaluable o presupuesto
  agotado queda `unknown`/`partial` y no causa penalización confirmada.
- Rechazar todo es accesible desde la primera vista con visibilidad equivalente
  y el mismo número de acciones que aceptar todo. La recarga mantiene la elección
  y no revive señales rechazadas; cualquier diferencia observada queda listada.
- Cada control individual relevante se comprueba aislado. Si tras apagarlo se
  observan solicitudes o cookies atribuibles al proveedor, el informe separa la
  declaración de interés legítimo de la conducta medida y señala la discrepancia
  sin interpretación jurídica.
- La lista de cookies/proveedores/dominios y los recuentos concuerdan con las
  observaciones allowlisted. Nunca se exponen valores de cookies, cuerpos,
  capturas, HTML ni secretos.
- La nota de Privacidad es independiente, muestra cobertura y usa los pesos y
  umbrales publicados de su versión. Los nuevos hallazgos no alteran el estado
  del sello.
- La API pública solo puede leer `run_id` y `assessment_json` de
  `ds_scan_privacy_assessments` mediante su rol de lectura; el worker no recibe
  permisos de lectura sobre esa tabla. El informe de estado y el historial
  siguen disponibles con privilegios mínimos en la base de producción.
- Las comprobaciones adicionales se asignan a la categoría acordada. El informe
  identifica fecha, navegador/contexto regional, pasos, evidencia, cobertura y
  límites.
- Las pruebas de seguridad demuestran aislamiento y bloqueo de SSRF, rebinding,
  destinos privados, redirecciones no permitidas, métodos no autorizados y
  agotamiento de recursos, usando destinos señuelo; no hacen tráfico real a
  dominios de clientes.
- La ejecución sigue siendo `unknown` hasta que el runtime y su política de
  egress superen las pruebas del entorno real autorizado. No se despliega un
  cambio que active navegación sin esas pruebas.
- CI debe ejecutar además el smoke Chromium de consentimiento y controles por
  proveedor con fixture sintético, `--network none`, filesystem de solo
  lectura, usuario no root y límites de recursos. La fixture nunca es evidencia
  de dominio ni se envía a informes.

## Política cuantitativa y de fuentes aprobada para la versión 1

- **Exceso contextual:** contar solo señales no esenciales confirmadas después
  del consentimiento, porque la actividad previa se valora en su criterio de
  30 puntos. Marcar exceso si un proveedor acumula más de cinco cookies activas
  del mismo propósito, o si un propósito supera diez cookies activas entre
  todos los proveedores. No imponer un límite bruto de proveedores: penalizar
  únicamente duplicados con la misma función observable.
- **Presupuesto agregado por análisis:** 120 segundos, 300 solicitudes HTTP(S),
  20 MiB recibidos, 30 controles de proveedor y ocho contextos limpios. Al
  agotar cualquier tope, lo no cubierto queda `unknown`; CPU y memoria usan los
  límites del contenedor navegador dedicado, fijados y documentados antes de
  activarlo.
- **Fuentes locales:** reutilizar el snapshot Apache-2.0 de Open Cookie Database
  como indicio y completar vendors/CMP con documentación pública y reglas
  propias revisadas. Guardar URL, fecha, licencia y confianza; excluir fuentes
  no comerciales y no consultar fuentes remotas durante el análisis. Una
  penalización requiere evidencia observada atribuible además de la regla.

El transporte pasivo actual limita cada scan a 24 solicitudes y 2 MiB
acumulados, limita la respuesta HTML a 64 KiB, permite hasta tres redirecciones
y usa un timeout de 10 segundos por operación. Son valores confirmados en
`transport-v1-executor-protocol.ts` y `pinned-https-transport.ts`; no se deben
reutilizar sin más para Solistos, porque los contextos de aceptar/rechazar y los
proveedores individuales multiplican las solicitudes. La política de navegador
debe definir presupuestos agregados propios antes de implementar.

### Revisión inicial de fuentes

- El primer catálogo propio `privacy-knowledge-v1` contiene cuatro reglas
  revisadas de Google Analytics: dos hosts de recogida y las cookies `_ga` y
  `_ga_<container-id>`. Se basan en documentación oficial de Google Developers
  consultada el 21 de noviembre de 2026; se conserva una URL por regla y la
  documentación de Google Developers declara CC BY 4.0 salvo excepciones. La
  coincidencia de una cookie propia requiere una solicitud del mismo flujo a
  `google-analytics.com` o `analytics.google.com`; un nombre aislado queda
  `unknown`. La regla de host acredita el proveedor/endpoint, pero no el tipo
  concreto de evento ni el contenido transmitido. No se añadieron valores,
  muestras de usuarios ni texto copiado de la documentación.
- Microsoft Learn documenta nombres y propósitos de cookies de Clarity, pero su
  licencia de reutilización para este catálogo no quedó confirmada en esta
  revisión; esos datos no se incluyen por ahora. Cada futura regla requiere
  resolver también su procedencia/licencia antes de entrar en el catálogo.

- El repo ya incluye un snapshot local de Open Cookie Database en
  `apps/desarrollo-seguro/worker/src/data/cookie-pattern-catalog.ts`, fijado al
  commit `7786335566460016f07a50705a92fc781c976f6f` y acompañado por el aviso
  Apache-2.0. La fuente ofrece categorías de cookies, patrones, plataforma,
  dominio, controlador, retención y enlaces; no demuestra que una cookie
  concreta aparezca en la página ni cubre por sí sola almacenamiento dinámico,
  flujos CMP o las declaraciones actuales de interés legítimo.
  La revisión estructural local del snapshot encontró 1.255 entradas: 391 de
  Analytics y 864 de Marketing; no incluye categorías Functional, Security o
  Personalization. Hay 442 entradas sin dominio de referencia, 41 sin enlace de
  privacidad y 10 pares duplicados `pattern`/`match`. Por ello se tratará como
  una fuente de indicios clasificados, con cobertura/confianza explícita, no
  como una verdad de referencia suficiente para fallar por sí sola.
  La inspección de las colisiones muestra nombres reutilizados por distintos
  vendors (por ejemplo, `DSID`, `auid`, `pid`, `optout` y nombres de una sola
  letra) con dominios asociados diferentes. Una coincidencia basada solo en el
  nombre nunca confirma proveedor ni incumplimiento; una penalización requiere
  además atribución reproducible por dominio/origen y categoría.
- DuckDuckGo Tracker Radar y Ghostery Tracker Database tienen metadatos
  relevantes de dominios y entidades, pero sus datasets públicos indican
  CC-BY-NC-SA-4.0. No son candidatos para integrar en este producto sin una
  licencia comercial compatible; no se han copiado ni añadido al repo.
- La clasificación de terceros aprobada compara hostnames normalizados: el
  hostname solicitado y su alias `www` son propios; todo otro hostname es
  externo, aunque comparta el dominio registrable. No requiere una Public
  Suffix List ni una dependencia para agrupar dominios.

### Contrato candidato de regla local

Cada regla de la base local deberá contener, como mínimo:

- `ruleId`, versión de dataset y tipo de señal (`cookie_name`,
  `storage_key`, `request_host`, `script_url` o `cmp_vendor`).
- Patrón declarado y modo de coincidencia seguro (exacto o prefijo anclado),
  categoría/purpose, vendor y posibles dominios/alias asociados.
- Procedencia consultable, revisión/versión de la fuente, `reviewedAt`,
  licencia del dato, `confidence` (`high`, `medium`, `low`) y falsos positivos
  conocidos.
- Base de tratamiento declarada por la interfaz, si existe, separada de la
  categoría técnica observada. Un campo de “interés legítimo” describe el texto
  declarado por el sitio o CMP y nunca acredita que esa base sea lícita.

No aceptar patrones regex libres ni acumular valores personales; coincidencias
por nombre ambiguo, dominio ausente o fuente caducada no producen fallo sin
corroboración de solicitud/origen. La publicación de un vendor requiere una
regla vigente y una observación atribuible, y conserva las referencias de
fuente/revisión para que pueda corregirse.

## Secuencia de cambios

El objetivo cubre la fase completa y autoriza ejecutar esta secuencia en cambios
pequeños y revisables. No desplegar Grumphya ni cambiar su código.

1. Cerrar este documento y el contrato versionado del rubric, umbrales, evidence
   schema, alcance y límites.
2. Implementar el browser runner dedicado, contención y broker de egress con
   límites compartidos; demostrar ataques SSRF, DNS rebinding, redirecciones,
   métodos y cuotas en laboratorio.
3. Capturar evidencia de carga inicial y local knowledge matching, con
   allowlist de datos y procedencia versionada.
4. Implementar detección del diálogo, conteo de acciones/visibilidad, flujos de
   aceptar/rechazar, recarga y controles individuales relevantes; probar el
   recorrido en Chromium real contra un fixture servido por rutas locales y
   sin red.
5. Añadir evaluación y persistencia versionadas sin alterar certificación;
   migrar de forma aditiva y cubrir compatibilidad histórica.
6. Presentar la nota y los hallazgos por categoría en los informes públicos con
   la proyección acotada acordada y controles accesibles.
7. Añadir documentación humana en `doc/`, quitar de `wanna-bes.md` lo ya
   implementado, pasar SonarQube y las pruebas de laboratorio Lighthouse con los
   umbrales vigentes y ejecutar los gates CI/deploy autorizados.

## Notas del contrato actual para el plan

La inspección del código vigente confirma que el informe persiste resultados
allowlisted en `ds_check_results`; la API deriva `ethicsAssessment` de esos
checks, y el portal mantiene su tipo/tabla `REPORT_CATEGORIES` local. La versión
actual se identifica como `domain-ethics-v3` y describe Privacidad como lectura
de cookies iniciales sin interacción. La certificación Beta usa su propio
conjunto de controles.

Por tanto, el plan deberá añadir una política versionada nueva y una evaluación
`privacyAssessment` independiente en core/API/contrato público/UI, ampliar
evidencia y categorías del perfil de escaneo, mantener inmutables los informes
anteriores y demostrar que los controles nuevos no se incorporan por accidente
a las puertas del sello. No se debe reutilizar ni renombrar `ethicsAssessment`
para ocultar la cobertura anterior.

El runtime efímero actual mantiene separado el coordinador, el executor
estático y el broker. El executor/browserless corre con `network none`, 256 MiB,
0,5 CPU, 64 procesos y filesystem de solo lectura; el broker es el único
contenedor de análisis con red pública. Chromium necesitará un límite de
memoria/CPU propio medido en laboratorio y una política de egress dinámica pero
acotada para los recursos de la portada. No se elevarán los límites del VPS ni
se reutilizarán los del executor sin medir su impacto en el host y en los
servicios actuales.
