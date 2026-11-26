# Auditoría de URL y medición de rendimiento

El buscador público admite una dirección web con o sin esquema. Si se omite,
añade `https://`; un esquema explícito se conserva y se validan únicamente
URLs HTTPS. El ejemplo del campo muestra solo un dominio, sin ruta ni
parámetros. La auditoría se limita a la ruta introducida y conserva su query;
elimina el fragmento, rechaza credenciales y puertos distintos del HTTPS por
defecto. La cola guarda la URL hasta que el trabajo termina y la elimina
entonces. El informe persistido conserva la ruta y la query como parte de su
alcance.

La protección contra abuso aplica un límite de 24 horas a cada URL normalizada
(hostname, ruta y query, sin fragmento), además del límite de solicitudes por
minuto y de cola. Solo puede ejecutarse un análisis solicitado por hostname a
la vez. Una petición duplicada de la misma URL activa reutiliza ese trabajo;
otra ruta/query espera a que termine sin reutilizar el resultado ajeno. Los
escaneos programados tampoco consumen el límite de una URL solicitada.

En cada deploy autorizado, el provisionador avanza un epoch global de admisión
antes de actualizar los servicios. Los trabajos encolados antes del deploy no
consumen la caché de 60 minutos ni el cooldown de 24 horas para ninguna URL,
aunque terminen después. Los informes se conservan intactos en el historial y
el cambio no genera análisis por sí solo. Una nueva solicitud puede producir
un informe con el código desplegado, sujeta a los límites de cola, solicitudes
y ejecución concurrente.

Rendimiento móvil lo calcula Lighthouse 13.6.0 en modo `simulate`, solo con la
categoría Performance, sobre la URL exacta. Así se usa su simulación de red,
CPU, métricas y puntuación oficial en lugar de emular condiciones de red y
recalcular la nota por separado. Se guardan FCP, Speed Index, LCP, CLS, TBT,
TTFB, bytes y la puntuación; TTFB y bytes son datos diagnósticos. El navegador
se ejecuta detrás del proxy seguro del auditor, con solicitudes GET/HEAD y
WebSockets bloqueados. No se persiste el informe Lighthouse, capturas ni
contenido de la página.
Lighthouse usa mediante Puppeteer el ejecutable `chrome-headless-shell` de la
misma revisión de Chromium que Playwright. El smoke de la imagen arranca ese
mismo binario. Ambos procesos se ejecutan como usuario sin privilegios, con
`--no-sandbox`, capacidades eliminadas y salida de red limitada al proxy
seguro, dentro del contenedor efímero.

Escritorio se mide en Chromium a 1365×768 sin throttling y conserva la rúbrica
lineal anterior:

| Métrica escritorio | Peso | Umbral bueno (100) | Umbral malo (0) |
| --- | ---: | ---: | ---: |
| FCP | 15 % | 1,8 s | 3 s |
| LCP | 25 % | 2,5 s | 4 s |
| CLS | 20 % | 0,1 | 0,25 |
| TBT | 20 % | 200 ms | 600 ms |
| TTFB | 15 % | 800 ms | 1,8 s |
| Datos transferidos | 5 % | 1,6 MB | 4 MB |

La nota global sigue siendo la media aritmética de móvil y escritorio.

Si falta cualquier métrica requerida, el perfil queda sin nota y la tarjeta no
promedia resultados parciales.

Esperar a que la red quede inactiva tiene un límite de 15 segundos. Si vence,
Chromium aún evalúa las métricas capturadas dentro del presupuesto de la
observación; un perfil solo queda `unknown` si sigue faltando un dato requerido
o si falla la captura. En ese caso el worker registra el perfil y los nombres
de los datos ausentes, sin guardar la URL, el hostname, contenido de página ni
texto de excepción. Las métricas parciales no se guardan ni publican. El informe
identifica la falta de métricas móviles o de escritorio por separado de la
respuesta HTTP inicial.

Si Lighthouse lanza una excepción, el contenedor devuelve al coordinador solo
una fase acotada (`launch_browser`, `configure_page`, `run_lighthouse` o
`read_result`) y una clase normalizada (`timeout`, `target_closed`, `protocol`,
`type` u `other`). El coordinador valida estos valores y los escribe en su log
operativo; no los incluye en la evidencia pública ni conserva el texto de la
excepción.

La observación de privacidad y los perfiles de rendimiento disponen cada uno
de hasta 120 segundos. Son plazos independientes: el tiempo empleado por los
flujos de privacidad no reduce el de móvil y escritorio. El contenedor y el
coordinador tienen un límite exterior que permite completar ambas mediciones,
además del escaneo base y la limpieza.

El estado de Rendimiento se resuelve al final, cuando se combinan la respuesta
HTTP inicial y los dos perfiles de Chromium. Un `unknown` provisional por datos
de Chromium aún no disponibles se convierte en `pass` solo si están presentes
la evidencia HTTP y las métricas completas de ambos perfiles; una respuesta superior a 2.500 ms
mantiene `fail`. Si falta cualquier dato requerido, permanece `unknown`.

El informe público conserva las métricas de ambos perfiles, incluido Speed
Index móvil, en la evidencia de Rendimiento. Si el control queda incompleto,
su resumen nombra el perfil y las métricas que faltan. PostgreSQL valida los mismos campos y límites numéricos que el
saneador de la aplicación; un resultado de rendimiento marcado como `pass`
requiere el conjunto móvil y escritorio completo. La cola conserva la URL
solicitada hasta terminar el trabajo, pero el informe almacena la ruta y query
como scope y no conserva el fragmento.

La persistencia también valida los resúmenes públicos de observación Chromium
para cookies y rastreadores en `domain-v5`. El contrato SQL debe coincidir con
los textos generados por el saneador; una discrepancia rechaza el informe aunque
la medición haya terminado correctamente. La integración PostgreSQL cubre
informes v5 con observaciones completas en ambos controles.

La prueba incluye recursos HTTPS de terceros que la página cargue mediante
GET/HEAD. El proxy valida los destinos, fija DNS a IPv4 pública y limita
solicitudes, bytes y duración. No envía formularios ni realiza acciones de
escritura.
