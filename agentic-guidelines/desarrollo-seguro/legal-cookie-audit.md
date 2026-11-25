# Auditoría jurídica de cookies y consentimiento — especificación propuesta

Estado: especificación aprobada para implementación incremental. Los primeros slices implementan adquisición temporal de evidencia y una capa de hallazgos LSSI independiente; la puntuación, el informe legacy y la presentación jurídica requieren sus tareas acordadas. La fuente transversal de filosofía es `agentic-guidelines/legal-evidence-and-sanctions.md`.

## Propósito

Detectar y publicar incumplimientos legales observables en el uso de cookies y tecnologías equivalentes. Cuando la ejecución del navegador demuestra todos los elementos de una regla legal versionada, el resultado se nombra **incumplimiento legal acreditado** y muestra la evidencia y el precepto aplicable. No se rebaja a «señal», «riesgo» o «susceptible de sanción» por una cautela genérica.

La herramienta acredita hechos técnicos y aplica una regla jurídica explícita. No afirma que una resolución administrativa o judicial ya haya declarado responsable al titular, ni convierte un máximo legal en una multa impuesta o garantizada.

## Alcance de la primera entrega

- Primera visita de una página pública en Chromium, con perfil nuevo y almacenamiento limpio.
- Captura del banner y de los enlaces visibles en primera capa.
- Tras `DOMContentLoaded`, buscar controles visibles de consentimiento durante un máximo de cinco segundos, en intervalos de 250 ms. Esto cubre CMP que se monta de forma asíncrona; solo declarar que no hay banner al agotarse el plazo con la captura completa. Si la comprobación se interrumpe por el presupuesto o una cancelación, el estado queda desconocido.
- Observación antes de aceptar o rechazar, después de cada acción y después de recargar.
- Los botones visibles del CMP se clasifican por su etiqueta y contexto. Un `<button>` independiente sin atributo `type` puede activarse aunque el navegador le asigne por defecto `type="submit"`; solo se bloquean controles dentro de un formulario real. Las escrituras continúan limitadas a la ventana temporal del clic de consentimiento.
- Cookies, almacenamiento web y peticiones de terceros, con atribución temporal exacta. Cada análisis permite hasta 1.000 solicitudes y conserva hasta 400 eventos de red por flujo para mantener la correlación temporal de páginas con muchos recursos, incluidas las solicitudes de recarga tras una elección; al superar cualquiera de los límites la cobertura se marca incompleta. El total recibido se limita a 64 MiB por análisis, suficiente para completar los flujos independientes en sitios cuyo contenido supera el límite anterior de 20 MiB.
- Las solicitudes bloqueadas por las salvaguardas del auditor se conservan separadas de los hosts cuyas respuestas sí se recibieron. Pueden corroborar qué proveedor intentó contactar el sitio, pero el informe las identifica como bloqueadas antes de transmitirse.
- La respuesta JSON del navegador aislado admite hasta 1 MiB para conservar cronologías de flujos independientes con muchos recursos. Antes de evaluar se valida la forma de la respuesta; un límite excedido se registra como `executor_response_too_large` en la fase `privacy_browser_observation` y no como una observación con campos ausentes.
- Flujos independientes de aceptación y rechazo para evitar que el estado de uno contamine el otro.
- Reglas para LSSI, RGPD y LOPDGDD; vía de consumo/LCD cuando la actividad y los elementos legales observados permitan aplicarla.
- No se considera infracción autónoma el mero hecho de que la página permita navegar mientras el aviso está visible.
- La ausencia de un control «Rechazar» no es por sí misma un incumplimiento. Si el inventario completo de primera visita solo acredita cookies técnicas/exentas y el aviso informativo enlaza a la política de privacidad, ese caso se evalúa como limpio; no se exige una interfaz de consentimiento para cookies que no requieren consentimiento.
- La visita al enlace de política se captura como fase distinta en un contexto
  nuevo: conservar por separado la instantánea de primera entrada y la
  instantánea posterior a navegar al enlace, ambas con nombres, dominios,
  atributos de cookies y claves/tipos de almacenamiento, sin valores y con
  tiempos monotónicos. No se pulsa «Entendido» ni se inventa una acción de
  rechazo durante esta fase. Una cookie observada solo después de abrir la
  política no es una cookie pre-consentimiento ni una cookie posterior al
  rechazo; no genera un hallazgo de rechazo ausente.
- Regresión documentada de Grumphya: `grumphya_anon` aparece como cookie propia
  al abrir la política de privacidad, no en la instantánea inicial limpia. La
  evidencia aportada indica `Secure`, `HttpOnly`, `SameSite=Strict` y expiración
  el 29-12-2027; la política describe su finalidad como mantener el perfil
  anónimo y limitar los intentos gratuitos. Esa cuota forma parte del servicio
  solicitado y se trata como cookie técnica, no de terceros ni de seguimiento.
  No se atribuyen claves de almacenamiento de sesión a esta evidencia. La
  falta de botón de rechazo no genera hallazgo cuando el inventario observado
  se limita a cookies técnicas y el aviso enlaza la política. La ocurrencia
  posterior a abrir la política permanece separada de la instantánea inicial.
- Fingerprinting y cabeceras HTTP son comprobaciones diferenciadas; no se deducen de la mera presencia de Google Analytics ni de una puntuación general.

## Secuencia probatoria del navegador

Cada flujo parte de un contexto Chromium nuevo. El registro distingue estos estados:

1. **Inicio de navegación:** anotar orden y tiempo monotónico de cada petición desde el primer byte; registrar cookies recibidas (`Set-Cookie`) y enviadas, identificadores de almacenamiento y scripts que se ejecutan antes de que el usuario interactúe.
2. **Primera capa:** guardar captura del aviso, texto, controles accesibles, enlaces y destinos; registrar posición, área, tipografía, color, contraste y estilo calculado de aceptar, rechazar y configurar.
3. **Antes de elegir:** guardar inventario de cookies y almacenamiento, incluyendo nombre, dominio, atributos y primera/última observación; no conservar valores de cookie.
4. **Acción explícita:** registrar control pulsado, etiqueta, hora, secuencia de pasos y cambios de estado detectados.
5. **Inmediatamente después:** tomar nuevo inventario y registrar solo eventos de red posteriores a la acción. Mantener separados los eventos previos.
6. **Recarga:** tomar otro inventario; comprobar el estado de rechazo en el CMP y verificar cookies y peticiones posteriores a la recarga. La ausencia de botones no basta para acreditar que la decisión se conservó.
7. **Resultado:** presentar líneas temporales diferenciadas para antes de elegir, después de rechazar y después de recargar; toda cobertura incompleta queda identificada y no equivale a cumplimiento.

Las evidencias persistidas no incluyen valores de cookies, credenciales, cuerpos completos de peticiones ni parámetros identificativos innecesarios. Se conservan URL normalizada sin query ni fragmento, host, tipo de recurso, método, estado, tiempo, iniciador cuando esté disponible y nombres de cookies/campos pertinentes. La captura visual evita formularios o contenido personal ajeno al aviso.

Cada flujo del primer slice de implementación emite inventarios separados `beforeChoice`, `afterChoice` y `afterReload`, marcas monotónicas de acción y recarga, más eventos de red con fase y tiempos monotónicos de inicio, respuesta y finalización, estado y bloqueo hecho por el auditor. El registro temporal se limita a 30 solicitudes por contexto y a 50 cookies/claves por snapshot; alcanzar un límite marca esa parte de la evidencia como incompleta sin alterar la puntuación ni la presentación legacy. Los valores de cookies y cuerpos de solicitudes/respuestas no se guardan. `phaseEvidence.rejectionChoiceStateAfterReload` permanece `unknown` hasta observar directamente el estado guardado de rechazo en el CMP; que el banner desaparezca no demuestra persistencia. El campo legacy `rejectionPersistedAfterReload` se conserva sin cambios de conducta para no modificar el informe existente y no se usa como prueba jurídica en la auditoría nueva.

Después de recargar el flujo de rechazo se reabre el panel de preferencias sin guardar cambios y se leen los interruptores atribuibles a proveedores locales conocidos de analítica, publicidad o redes sociales. Solo se leen controles dentro de un panel identificado por una acción «Preferencias/Configurar» o un control «Guardar» visible; no se toman interruptores genéricos de la página como preferencias del CMP. Se confirma el rechazo si hay controles y todos están identificados, su estado es legible y están desactivados. Un control identificado que siga activado acredita que el rechazo no se conservó para ese proveedor. Sin panel reconocido, sin controles visibles, con interruptores no atribuibles o con estados ilegibles, el resultado es `unknown`. Los datos incluyen proveedor, estado, recuentos y fase de inspección, nunca el texto libre de la interfaz ni valores de almacenamiento. El presupuesto de escrituras se cierra antes de esta inspección, que registra sus solicitudes en la fase independiente `cmp_inspection`.

## Matriz legal inicial para España

La matriz se almacena versionada por jurisdicción, vigencia, fuente, regla, elementos jurídicos, evidencia exigida, clasificación y órgano competente. Una conducta puede activar varias filas si satisface los elementos de cada una. La LSSI permite tramitar otro procedimiento por los mismos hechos cuando otra ley los tipifica y no hay identidad del bien jurídico protegido; también excluye la duplicación en los supuestos de identidad previstos en su art. 44. El informe conserva cada vía concurrente, pero no suma automáticamente los máximos de multa.

| Conducta observable | Elementos probatorios que debe registrar el auditor | Regla y consecuencia que puede mostrar |
|---|---|---|
| Instalar o acceder a cookies no exentas antes del consentimiento | Cookie o acceso identificable, marca temporal previa a cualquier acción, dominio/finalidad sustentados por política, catálogo técnico o petición asociada | LSSI art. 22.2; tipificación leve art. 38.4.g; multa legal de hasta 30.000 € según art. 39. Competencia sancionadora de la AEPD para el art. 38.4.g conforme al art. 43.1. La excepción para almacenamiento técnico/estrictamente necesario debe verificarse, no presumirse. |
| Seguir enviando o usando cookies analíticas tras pulsar «Rechazar» | Acción de rechazo con hora; cookie en inventario posterior y/o petición posterior que envía su nombre; evidencia de que el identificador corresponde al proveedor/finalidad | LSSI arts. 22.2 y 38.4.g. Si los eventos acreditan además tratamiento de datos personales, evaluar RGPD arts. 5, 6, 7 y 25 y las categorías LOPDGDD correspondientes. Rechazar antes de consentir se modela como rechazo expreso, no como «retirada» de un consentimiento previo. |
| Declarar que las cookies solo se instalan con consentimiento y observar su instalación previa | Texto exacto visible antes de elegir, cookie no exenta identificada y cronología de instalación; captura reproducible | Contradicción directa con la conducta observada. Evaluar obligación de información de LSSI 22.2 y, si hay datos personales, transparencia/lealtad RGPD art. 5.1.a y deber de información de arts. 12–13; LOPDGDD art. 72.1.a/h cuando encajen sus elementos. |
| Rechazo menos visible o más difícil que aceptación | Captura y datos DOM/estilo de ambos botones; posición, dimensiones, contraste, jerarquía visual y número de acciones; comparación en escritorio y móvil | Criterio AEPD: rechazo en la misma capa, nivel y visibilidad y con mecanismo similar. La guía orienta la aplicación del consentimiento exigido por LSSI. El hallazgo visual se publica por separado; el art. 22.2/38.4.g se asocia a almacenamiento/acceso sin consentimiento válido probado, no a una diferencia estética aislada. |
| Ausencia de enlace visible y directo a información detallada de cookies en primera capa | Árbol de enlaces visible, texto y destino real; navegación directa y captura; comprobar si el enlace de footer existe y funciona | Criterio de primera capa de la Guía AEPD (enlace visible a segunda capa). Asociar a LSSI art. 22.2 si la información sobre uso/fines no fue clara y completa antes del uso. La falta de enlace por sí sola no se presenta como una multa independiente tipificada en el art. 38.4.g. |
| Mensaje implícito de consentimiento por continuar navegando | Secuencia que demuestre que el sitio usa cookies sin una acción afirmativa específica; conservar texto y acciones disponibles | La guía AEPD recoge que seguir navegando no es consentimiento válido. La regla sancionadora se vincula al uso de cookies no exentas sin el consentimiento exigido, no al simple hecho de que la navegación no esté bloqueada. |
| Práctica comercial engañosa hacia consumidores | Servicio y contexto comercial visibles; audiencia consumidora; mensaje falso/omisión; materialidad para decisión económica según el precepto; evidencia reproducible del engaño | LCD arts. 5 y 7; TRLGDCU art. 47.m tipifica el uso de prácticas comerciales desleales con consumidores. Solo se añade esta vía cuando se acrediten sus elementos y la competencia territorial/material correspondiente; clasificación y rango se obtienen de TRLGDCU arts. 48–49 y normativa autonómica aplicable. No se activa solo porque haya un banner de cookies. |

### Marco sancionador que mostrará el informe

- Para la infracción de cookies LSSI art. 38.4.g, el texto vigente la califica como leve y el art. 39 fija un máximo de 30.000 €. No se afirmará que el mínimo legal sea 1.000 €: ese mínimo no aparece en ese precepto.
- Para RGPD art. 83.5, el máximo legal puede alcanzar 20 millones de euros o el 4 % del volumen de negocio anual mundial total del ejercicio anterior, si esta cifra es superior. El RGPD no establece una banda fija de 1.000–30.000 € para este caso.
- LOPDGDD arts. 72–74 califican tipos de infracción; no constituyen una cuarta multa acumulable independiente del régimen RGPD. Art. 72.1 recoge, entre otros, vulneraciones sustanciales de principios, licitud, validez del consentimiento e información; art. 73.d/e cubre obligaciones de protección desde el diseño y por defecto.
- El régimen de consumo (TRLGDCU art. 49) tiene rangos propios y posibles incrementos ligados al beneficio ilícito. Solo se muestra tras mapear la conducta a un tipo del art. 47 y a la autoridad competente.
- La vista separa **multa máxima legal**, **sanción propuesta en un expediente** y **sanción firme impuesta**; nunca las presenta como la misma cifra.
- La AEPD puede iniciar procedimientos por iniciativa propia o a raíz de reclamación (LOPDGDD art. 64.2); el expediente SEAT citado se inició de oficio y acabó con pago de multa. El informe no dirá que la denuncia es requisito para la multa ni que una denuncia por sí sola garantiza el resultado. Mostrará el incumplimiento acreditado, la autoridad, el máximo legal y, cuando ayude a contextualizar, precedentes con sanciones efectivamente impuestas.

## Precedente oficial de referencia

La resolución AEPD PS-00284-2024 contra SEAT documenta cookies no técnicas antes del consentimiento y persistencia/envío de cookies no técnicas después de revocar un consentimiento. La AEPD actuó **de oficio**, abrió procedimiento por LSSI art. 22.2 (art. 38.4.g), propuso 20.000 € y el procedimiento terminó tras el pago de 12.000 € y el reconocimiento de responsabilidad. Es un precedente directo que demuestra que no hace falta denuncia para que la AEPD investigue e imponga una multa por una conducta de cookies acreditada. La cifra final es un resultado concreto de ese expediente, no una tarifa automática para otros titulares.

La referencia encontrada de Wallapop (E/00993/2018) no es un precedente de cookies: trata de protección de datos y pagos, y terminó archivada. No se citará como precedente de este flujo.

## Requisitos de la salida legal

Cada hallazgo contendrá: identificador de regla y versión; nombre explícito del incumplimiento acreditado; hechos observados con línea temporal; artefactos probatorios; artículos y texto oficial vigente; autoridad con competencia para ese tipo; clasificación legal; marco sancionador aplicable y naturaleza de la cuantía (máximo legal, propuesta o resolución firme); fecha y hash del conjunto de evidencias; reglas de concurrencia aplicadas.

El slice LSSI inicial calcula `legalCookieFindings` separado de los controles técnicos. Solo crea un hallazgo si una cookie figura en `phaseEvidence` antes de la acción de consentimiento o después de la acción explícita de rechazo (inmediatamente después y tras recargar), y una regla técnica versionada de confianza alta la atribuye a una finalidad analítica, publicitaria o social. Para inventarios se requiere lectura completa; una cookie enviada o recibida se acredita directamente mediante su nombre y fase de red. La incompletitud de otra parte del flujo no invalida una observación positiva ya capturada en esa fase; la lectura incompleta sí impide concluir que no había cookies. Cada artefacto identifica flujo, fase, instante monotónico, cookie (nombre y dominio, nunca valor), regla de atribución y evidencia de red correlacionada cuando exista. La capa no altera los controles técnicos ni campos históricos.

Los hallazgos jurídicos se muestran aparte de las puntuaciones técnicas. Si existe al menos un `legalCookieFinding` acreditado o una contradicción de proveedores que contenga un `legalFinding.status = infraccion_legal_acreditada`, la puntuación global queda fijada en `0`, mínimo de la escala global vigente de 0 a 100; los controles correctos no pueden compensarla. Las puntuaciones técnicas por área se conservan y muestran por separado. Una contradicción factual sin mapeo legal completo, una comprobación no evaluada o una señal que no alcance los elementos de una regla jurídica no activa el bloqueo.

## Aceptación

1. Un fixture con analítica antes de elegir produce eventos pre-elección separados y el hallazgo LSSI correspondiente; no se confunde con tráfico posterior al rechazo.
2. Un fixture que conserva una cookie y envía una petición después de «Rechazar» produce el hallazgo de rechazo ineficaz, incluyendo la evidencia posterior al clic y tras recargar.
3. Una cookie técnica documentada y una navegación permitida sin instalar tecnologías no exentas no producen el hallazgo LSSI de falta de consentimiento.
3a. Un aviso informativo sin control «Rechazar», con enlace accesible a la política y un inventario completo que solo contiene una cookie técnica, pasa la comprobación de acceso a la política y no genera un hallazgo de rechazo ausente.
3a.1 La evidencia de acceso desde un aviso informativo (`information_notice`) se conserva y valida de extremo a extremo. El contrato de persistencia SQL debe admitir los mismos valores, combinaciones y campos opcionales que `parseFirstEntryPolicyAccess` en TypeScript, incluido `policyLinkVisit` con sus instantáneas acotadas antes y después de abrir el documento. Las pruebas PostgreSQL cubren el aprobado desde aviso informativo con y sin ese campo, las instantáneas válidas y los fallos por cookies de terceros o evidencia de visita malformada. Una divergencia entre validadores no puede convertir un resultado de auditoría válido en error de guardado.
3a.2 Si una comprobación no se puede persistir por incumplir su contrato SQL, los logs internos deben distinguir de forma segura entre required, severidad, resumen, limitación, forma y tamaño de evidencia. No se registran valores de evidencia ni datos del sitio en esos diagnósticos.
3a.3 Los códigos de error de probes (`probeErrorCode` y la matriz TLS) deben producir exactamente el mismo resumen en TypeScript y PostgreSQL. Las pruebas PostgreSQL cubren los códigos permitidos que tienen una etiqueta específica, incluido `transport_failed`, en cada control domain-v4 que los admite.
3b. La cookie propia `grumphya_anon` aparece solo en la instantánea posterior a abrir la política; se conserva con su fase/tiempo, dominio y atributos, sin valores, y no se convierte en fallo de rechazo. La finalidad declarada de límite de intentos gratuitos y la duración de 400 días quedan disponibles para evaluación separada de necesidad/retención.
4. La persistencia del rechazo se acredita con el estado guardado del CMP más el comportamiento posterior, no solo por la desaparición del banner.
5. Las diferencias visuales de aceptar/rechazar se respaldan por captura y medidas DOM en móvil y escritorio.
6. Texto falso y enlace ausente se muestran como hechos separados y solo reciben los artículos/multas que el mapa legal haya conectado a sus elementos.
7. RGPD, LOPDGDD, LSSI y consumo aparecen como regímenes distintos, con órganos y cuantías correctos; ningún importe se calcula por suma automática.
8. «No bloquea la navegación» por sí solo no genera un incumplimiento.
9. La cobertura incompleta nunca produce resultado de cumplimiento.
10. Un `legalCookieFinding` acreditado o un `legalFinding` de proveedor acreditado fija la puntuación global en 0; ninguna nota técnica puede compensarlo.
11. Las notas técnicas por área permanecen visibles aunque el bloqueo legal fije la puntuación global.
12. El informe público expone los hallazgos y evidencia verificable sin valores de cookies, credenciales, cuerpos completos de requests ni datos personales innecesarios.
13. Una cookie directamente observada en una fase con inventario completo conserva su hallazgo legal aunque una acción, recarga o fase posterior del mismo flujo haya quedado incompleta.
14. Los botones independientes de aceptar, rechazar y gestionar preferencias que omiten `type` se reconocen y activan; controles dentro de formularios no se envían. La prueba de regresión cubre el marcado HTML con `type` implícito `submit` y comprueba que el flujo posterior a rechazar se ejecuta.
15. El auditor detecta y registra controles de consentimiento que aparecen hasta cinco segundos después de `DOMContentLoaded`; si el presupuesto interrumpe la búsqueda, no informa que el banner está ausente ni marca los controles como «no aplica».
16. La evidencia de cookies de primera parte puede atribuirse a un proveedor cuando la misma fase registra una solicitud de ese proveedor bloqueada por el auditor; el informe expone el host en `auditBlockedRequestHosts` y no afirma que esa solicitud llegara al proveedor.
17. Tras el rechazo, si la instantánea completa muestra la misma cookie (nombre y dominio) que ya estaba presente antes de elegir en ese flujo aislado, la atribución de proveedor puede corroborarse con las solicitudes de esa fase previa. Se registra `corroborationPhase: "before_choice"`; el informe distingue el momento en que persistió la cookie de la fase usada para identificar al proveedor. Si la solicitud fue bloqueada por el auditor, se conserva como intento bloqueado y nunca como transmisión completada.
18. Un fallo al calcular la puntuación de privacidad no descarta la observación ni impide construir y persistir hallazgos legales con esa evidencia. La puntuación y la evaluación legal se calculan en pasos aislados; el fallo de uno no borra el resultado del otro.
19. Una carga JSON de navegador de hasta 1 MiB llega completa al coordinador; un límite excedido y una respuesta malformada se identifican en `privacy_browser_observation` con `executor_response_too_large` o `executor_response_invalid`, nunca como errores posteriores del evaluador o del constructor legal.

## Fuentes oficiales iniciales

- [LSSI, Ley 34/2002, texto consolidado](https://www.boe.es/buscar/act.php?id=BOE-A-2002-13758)
- [RGPD, Reglamento (UE) 2016/679, art. 83](https://eur-lex.europa.eu/legal-content/EN/ALL/?uri=celex%3A32016R0679)
- [LOPDGDD, Ley Orgánica 3/2018](https://www.boe.es/buscar/act.php?id=BOE-A-2018-16673)
- [Guía de cookies de la AEPD](https://www.aepd.es/guias/guia-cookies.pdf)
- [LCD, Ley 3/1991, arts. 5 y 7](https://www.boe.es/buscar/act.php?id=BOE-A-1991-628)
- [TRLGDCU, Real Decreto Legislativo 1/2007](https://www.boe.es/buscar/act.php?id=BOE-A-2007-20555)
- [AEPD, procedimiento PS-00284-2024 (SEAT)](https://www.aepd.es/documento/ps-00284-2024.pdf)
