# Privacidad observable (Solistos v1)

Solistos añade una dimensión independiente de Privacidad a los informes de
análisis de la portada. Busca señales técnicas observables sobre cookies,
almacenamiento del navegador, solicitudes a otros hosts y decisiones de
consentimiento. Una web sin seguimiento conocido puede recibir evidencia
positiva aunque no muestre un banner. Solistos no emite conclusiones de
conformidad legal ni modifica el estado del sello.

En la puntuación global del MVP, Privacidad aporta el 50 % y Ética aporta el
50 %. Ética usa `domain-ethics-v3` si el informe no incluye evaluación de
procesadores backend y `domain-ethics-v4` cuando la incluye, según la
[especificación de transparencia backend](../agentic-guidelines/desarrollo-seguro/backend-processor-transparency.md).
El resultado se redondea al entero más cercano. Ambas puntuaciones se presentan
también por separado. Si alguna
dimensión carece de cobertura suficiente, el estado global queda «En revisión»
y no se muestra una cifra combinada; las notas parciales y su cobertura siguen
visibles. Los criterios no aplicables no impiden el cálculo. Los informes
históricos sin evaluación `privacy-v1` no reciben una nota global combinada.

## Cómo se realiza el análisis

Cada análisis usa Chromium 1.65.0 en un contenedor efímero y un proxy de salida
dedicado. El navegador se configura en español (`es-ES`) y zona horaria de
Madrid; el informe identifica ese contexto. Solo se visita `/` del host
analizado. Se observan la carga inicial, aceptar, rechazar, la persistencia del
rechazo después de recargar y los controles individuales que coinciden con una
regla local revisada de proveedor.

Las páginas públicas y sus recursos se ejecutan dentro del navegador aislado.
Por ello los hosts contactados pueden recibir la IP pública de salida del
auditor. El proxy bloquea destinos no públicos, métodos no permitidos y
solicitudes fuera de alcance. Solo abre una ventana temporal para escrituras
de preferencias al elegir una opción o cambiar un proveedor. No envía
formularios ni realiza acciones de cuenta.

El presupuesto máximo agregado por análisis es de 120 segundos, 300 solicitudes
HTTP(S), 20 MiB recibidos, 30 controles de proveedor y ocho contextos limpios.
Los flujos usan contextos separados; los controles por proveedor que excedan la
capacidad disponible quedan `unknown`/`partial` y no se penalizan. Se destruyen
los contextos al terminar.

La falta de un rechazo utilizable o de paridad con aceptar es un incumplimiento
confirmado cuando el navegador ha funcionado y ha podido inspeccionar la
interfaz. La opacidad del sitio no se considera un `unknown`. Si un error propio
de Chromium, proxy o runtime impide evaluar criterios, se conservan como
`unknown`, el informe queda «En revisión» y no se publica la cifra global
combinada hasta resolverlo.

El aprovisionamiento de producción concede al rol `ds_worker` permiso de
ejecutar únicamente la función de finalización que persiste conjuntamente el
informe y su evaluación de Privacidad. La función legacy que no guarda esa
evaluación permanece revocada para el worker. La suite PostgreSQL comprueba
ambos permisos con los roles de runtime.

## Cómo leer la nota

La nota `Privacidad` es independiente del sello y aporta el 50 % de la nota
global del MVP junto con la puntuación Ética vigente, que aporta el 50 %
restante. Ética usa v3 sin evaluación backend o v4 cuando existe esa evaluación.
La nota Privacidad no concede, bloquea ni suspende una
certificación. Se calcula con la política versionada `privacy-v1`:

| Criterio | Peso |
| --- | ---: |
| Actividad no esencial antes de elegir | 30 |
| Exceso y redundancia contextual | 10 |
| Visibilidad de aceptar y rechazar | 20 |
| Eficacia del rechazo y persistencia | 20 |
| Controles de proveedores | 20 |

Cada hallazgo confirmado descuenta 0,25 (bajo), 0,5 (medio) o 1 (alto) punto
absoluto, hasta el peso del criterio. Coincidencias dudosas y evidencia
incompleta por un fallo o límite del auditor quedan como `unknown` y restan
cero. Los criterios desconocidos se excluyen del denominador; el informe muestra
la cobertura y los no aplicables. La opacidad de una interfaz no queda
`unknown` si el navegador está funcionando y pudo inspeccionarla; no hallar un
rechazo utilizable con paridad es un incumplimiento puntuable.
Si no hay señales conocidas y la observación está completa, la ausencia de
panel no baja la nota.

La regla cuantitativa inicial cuenta solo señales no esenciales activas después
de consentir: exceso si un proveedor tiene más de cinco cookies de un mismo
propósito o si un propósito supera diez cookies entre proveedores. No hay un
límite bruto de proveedores: solo se considera duplicación cuando se observa
que varios proveedores realizan la misma función.

## Evidencia y límites

El informe puede enumerar nombres de cookies y claves, proveedores y hosts
observados; no incluye valores de cookies, almacenamiento, cuerpos, HTML,
capturas, formularios ni credenciales. Distingue intentos bloqueados de
solicitudes completadas. Una coincidencia de nombre por sí sola no confirma el
proveedor: la regla local requiere atribución reproducible por el host/origen.

La API de producción lee solo el identificador del informe y `assessment_json`
de la tabla dedicada a esta evaluación. El worker no recibe permiso de lectura
sobre esa tabla y la fecha interna de persistencia no se expone.

El catálogo local v2 conserva las reglas originales de Google Analytics y
añade señales observables para Google Ads/Conversion Linker, Meta Pixel, TikTok
Pixel, LinkedIn Insight Tag, Matomo Cloud y los CMP Cookiebot, Didomi, iubenda,
OneTrust/CookiePro y Usercentrics. Cada regla conserva la URL, la fecha de
revisión, la licencia declarada, la confianza y los falsos positivos conocidos.
No se consultan catálogos remotos durante cada análisis.

Incluir Matomo significa únicamente reconocer señales del sitio auditado. No
instalamos Matomo ni añadimos SDK, cookies, cuentas, endpoints ni telemetría a
Desarrollo Seguro. Matomo Cloud se reconoce por su host observado; una cookie
first-party solo se atribuye si ese mismo flujo también contactó un host de
Matomo verificable. Las instalaciones On-Premise ocultas tras un proxy propio o
un endpoint renombrado quedan sin atribución, porque no inspeccionamos rutas.
La navegación aislada sigue pudiendo contactar destinos que la página analizada
solicite por sí misma bajo el presupuesto de red publicado; este catálogo no
añade solicitudes. Una señal CMP se enumera como proveedor de consentimiento,
pero no cuenta como seguimiento, exceso ni incumplimiento por su sola presencia.
Una declaración de “interés legítimo” se registra como texto observado, no como
validación jurídica.

El alcance se limita a la portada y a señales catalogadas. No demuestra ausencia
total de seguimiento, conducta en otras rutas, en todas las regiones o en
navegaciones posteriores. Una evaluación `unknown` significa que una limitación
o un fallo del auditor impidió obtener evidencia suficiente. Si el sitio impide
identificar un control mientras la observación funciona, se informa como
incumplimiento puntuable del criterio de paridad en Privacidad.

## Uso operativo

El worker ejecuta Solistos con cada análisis manual y periódico. Las imágenes
de Chromium y del proxy se construyen como `development-security-privacy-browser`
y `development-security-privacy-egress`; el contenedor de Chromium no tiene
socket Docker ni montajes del host. CI ejecuta también un fixture sintético de
consentimiento y control de Google Analytics en Chromium con la red del
contenedor desactivada; ese resultado solo verifica el runtime y nunca se
presenta como evidencia de un dominio. Las pruebas de policy, presupuesto y
runtime se ejecutan con la suite del worker y los workflows de CI. Consulta
[Producción](production.md), [Verificación](verification.md) y la
[especificación operativa para agentes](../agentic-guidelines/desarrollo-seguro/solistos-phase.md)
para el despliegue, puertas y decisiones completas de la versión.
