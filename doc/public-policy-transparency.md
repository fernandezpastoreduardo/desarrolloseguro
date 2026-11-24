# Información pública sobre servicios externos

## Acceso legal en la primera entrada

El informe revisa la primera página en un contexto de navegador limpio. Si se
muestra un aviso de cookies, CMP u otro mecanismo que solicita consentimiento,
el enlace a privacidad, cookies, condiciones o aviso legal debe estar visible
dentro de ese mismo componente. Un enlace únicamente en el footer no cumple.
El auditor pulsa el enlace con navegación de solo lectura y registra si el
documento carga, junto con el host y la ruta, sin guardar query strings ni
fragmentos.

Si no se solicita consentimiento y la lectura inicial completa no detecta
cookies de terceros, un enlace pertinente del footer satisface esta comprobación.
Una solicitud de red a un tercero por sí sola no invalida esa excepción; la
recepción de datos por ese proveedor se evalúa aparte. Si la lectura no es
completa, el resultado es «no se pudo comprobar», no un aprobado ni un fallo del
sitio. El almacenamiento de terceros no esencial conserva su comprobación
separada.

El informe público muestra el resultado y la evidencia estructurada de esta
comprobación, la comparación de servicios externos y los hallazgos jurídicos
acreditados. Estos datos se conservan desde la ejecución aislada del auditor
hasta su presentación pública; no se descartan en el transporte interno.

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
escala sancionadora establecida por la norma. La escala legal no predice la
multa concreta que impondrá una autoridad. Si falta un elemento legal, el
informe conserva la contradicción y muestra qué estado del mapeo jurídico se
aplicó; no inventa artículos ni cuantías.

La ausencia de documentación pertinente, una fuente oficial no localizada y
un fallo técnico al abrir un enlace son resultados diferentes. No encontrar
una URL con las fuentes permitidas no demuestra que el proveedor carezca de
documentación.

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

El lector de red no envía cookies, credenciales ni `Referer`, solo accede por
HTTPS y limita el tiempo, el número de solicitudes y el volumen de datos.
Guarda evidencia mínima para respaldar el resultado, no copias completas de
páginas ni datos personales.
