# Información pública sobre servicios externos

## Acceso legal en la primera entrada

El informe revisa la primera página en un contexto de navegador limpio. Si se
muestra un aviso de cookies, CMP u otro mecanismo que solicita consentimiento,
el enlace a privacidad, cookies, condiciones o aviso legal debe estar visible
dentro de ese mismo componente. Un enlace únicamente en el footer no cumple.
El auditor pulsa el enlace con navegación de solo lectura y registra si el
documento carga, junto con el host y la ruta, sin guardar query strings ni
fragmentos.

Un aviso informativo visible que contiene un enlace operativo a la política
también se registra aunque no solicite consentimiento. Si no se solicita
consentimiento y la lectura inicial completa solo acredita cookies técnicas o
exentas, el enlace de ese aviso o del footer satisface esta comprobación; no se
exige un control de rechazo por la ausencia de cookies no esenciales. Una
solicitud de red a un tercero por sí sola no invalida esa excepción; la
recepción de datos por ese proveedor se evalúa aparte. Si la lectura no es
completa, el resultado es «no se pudo comprobar», no un aprobado ni un fallo
del sitio. El almacenamiento de terceros no esencial conserva su comprobación
separada.

El informe público muestra el resultado y la evidencia estructurada de esta
comprobación, la comparación de servicios externos y los hallazgos jurídicos
acreditados. Estos datos se conservan desde la ejecución aislada del auditor
hasta su presentación pública; no se descartan en el transporte interno.
La sección de servicios muestra además la versión inmutable del catálogo
oficial usado en ese informe.

Las mediciones de contenido inicial, referencias a rastreadores, política
pública y rendimiento siguen una redirección entre el hostname auditado y su
alias exacto con prefijo `www.`. Así el informe mide la portada final, no el
pequeño cuerpo HTML de un `301` o `308`. El seguimiento mantiene TLS, DNS,
puertos, rutas y límites del scanner; no sigue destinos ajenos ni combina los
informes de ambos hostnames. Esta regla se aplica a informes nuevos desde
`domain-v4-network-adapter-5`.

Los informes `domain-v4-network-adapter-6` incorporan a Ética y Privacidad la
instantánea inicial de cookies y el registro de solicitudes iniciado por
Chromium, además de las referencias visibles en HTML y las cabeceras. Las
cookies analíticas solo se atribuyen cuando coinciden con una regla revisada
del catálogo y existe una solicitud del mismo flujo al proveedor. Un intento
bloqueado cuenta como intento observado, no como transmisión; el detalle
muestra aparte cuántos intentos se bloquearon y cuántas solicitudes recibieron
respuesta. Los nombres y valores de cookies y las URL completas no se publican.

Desde `domain-v4-network-adapter-7`, los contadores acotados de esa observación
se conservan durante la ingestión y llegan al detalle público junto con los
estados, las puntuaciones y el veredicto calculados tras incorporar la
observación. Los informes anteriores mantienen sus evidencias y formato. El
pie de la ficha enlaza a la explicación del servicio
sin la frase «Comprobación técnica acotada desde el mismo VPS. No es una
certificación independiente.».

La navegación al enlace visible de política se comprueba en un contexto nuevo y
su estado posterior se muestra separado de la instantánea inicial. El informe
conserva tiempo monotónico, nombres, dominios y atributos de cookies y los
nombres, dominios y tipos de almacenamiento, sin sus valores. La inspección no
pulsa «Entendido» ni controles de consentimiento. Por eso una cookie que solo
aparece después de abrir la política no se presenta como instalada antes de
elegir ni como persistente tras rechazar.

En la evidencia aportada para Grumphya, `grumphya_anon` es una cookie propia
que mantiene el perfil anónimo y descuenta los intentos gratuitos. Aparece al
abrir la política; consta como `Secure`, `HttpOnly`, `SameSite=Strict`, con
expiración el 29-12-2027. Esa función de cuota forma parte del servicio y se
clasifica como técnica, no como seguimiento o cookie de terceros. No tener un
botón de rechazo no crea un incumplimiento cuando las cookies observadas son
técnicas y la política está enlazada desde el aviso. La evidencia no contiene
claves de almacenamiento de sesión.

## Proveedores, fuentes y contradicciones

El auditor identifica los proveedores que aparecen en la política y en los
flujos observados, incluidos servicios backend que no dejan cookies. Compara
las declaraciones explícitas del sitio con hechos que constan en documentos
oficiales del proveedor. El informe presenta por separado ambas fuentes,
versiones, fechas y fragmentos breves para que la contradicción pueda
reproducirse.

Una contradicción documental confirmada se incorpora al resultado y afecta a
la puntuación de transparencia. Cuando la evidencia satisface todos los
elementos de una regla jurídica versionada, el informe identifica la
infracción legal acreditada, los artículos, la autoridad competente y la
escala sancionadora establecida por la norma. Esa infracción fija en cero la
puntuación global (`mvp-global-v2`); las notas técnicas de Ética y Privacidad
se mantienen visibles por separado. La escala legal no predice la multa
concreta que impondrá una autoridad. Si falta un elemento legal, el informe
conserva la contradicción y muestra qué estado del mapeo jurídico se aplicó;
no inventa artículos ni cuantías ni activa el cero jurídico.

La ficha pública admite la precisión decimal de la valoración de Privacidad y
presenta las cuatro categorías con los criterios realmente recibidos. Si una
infracción legal queda acreditada, la puntuación global aparece en cero aunque
las valoraciones técnicas por área se conserven por separado.

Los hallazgos nuevos incluyen las fuentes públicas por elemento legal, con
título, enlace y fragmento breve. Los informes históricos con el formato
anterior siguen siendo válidos; los IDs de fuente antiguos no se interpretan
como enlaces que el lector pueda abrir.

La ausencia de documentación pertinente, una fuente oficial no localizada y
un fallo técnico al abrir un enlace son resultados diferentes. No encontrar
una URL con las fuentes permitidas no demuestra que el proveedor carezca de
documentación.

Un documento oficial que exceda los 64 KiB que el clasificador puede procesar
queda marcado `response_too_large`. El informe conserva ese recibo y continúa
con los demás documentos y señales de la página; no convierte la limitación de
un documento en un fallo de transporte de toda la auditoría.

## Catálogo y actualización

El catálogo guarda documentos oficiales conocidos, hechos documentados,
versiones, huellas SHA-256 y fechas de consulta. Si una fuente oficial falla,
el sistema registra el fallo y conserva la versión activa. Cada informe queda
asociado a la versión inmutable que utilizó; un refresco posterior no cambia
informes históricos.

El worker actualiza las fuentes oficiales catalogadas el día 1 de cada mes a
las 03:00, hora de `Europe/Madrid`, con reintentos si una fuente no está
disponible. Usa únicamente URLs oficiales obtenidas del sitio auditado o ya
registradas en el catálogo; no usa buscadores externos. La versión actualizada
se utiliza en auditorías posteriores.

Si una auditoría aporta una fuente o una referencia nueva para un proveedor ya
catalogado, se añade a una nueva versión inmutable sin sustituir las evidencias
anteriores. Una repetición idéntica no genera otra versión. Si un identificador
de documento existente llega con URL o contenido incompatible, el sistema
rechaza esa combinación para no sobrescribir la evidencia registrada.

El lector de red no envía cookies, credenciales ni `Referer`, solo accede por
HTTPS y limita el tiempo, el número de solicitudes y el volumen de datos.
Guarda evidencia mínima para respaldar el resultado, no copias completas de
páginas ni datos personales.
