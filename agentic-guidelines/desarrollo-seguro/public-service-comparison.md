# Comparación pública de servicios externos

## Propósito

La ficha compara la transparencia pública de todos los dominios con los mismos
criterios. La evidencia privada que comparten los clientes certificados se
presenta en una sección adicional y no sustituye ni altera la comparación
pública común.

## Evidencia común

- **Servicios observados:** usar solo los proveedores y dominios de terceros
  confirmados por la observación pública del mismo análisis. Se pueden usar los
  nombres de proveedores ya derivados por Solistos; no guardar valores de
  cookies, cuerpos, query, fragmentos ni datos personales.
- **Servicios declarados por el sitio:** consultar la política pública del
  dominio. Para que una declaración coincida con un servicio observado, debe
  identificar al proveedor y explicar el servicio o la finalidad que cumple.
  Una mención aislada del nombre del proveedor no basta.
- **Servicios declarados pero no observados:** no se penalizan por sí solos,
  pues pueden intervenir en procesos que no activa la navegación observada. Se
  muestran como declaración, no como actividad confirmada. Solo pueden
  cambiar a «Ilegalidad detectada» si el uso declarado coincide con una regla
  legal explícita, aplicable y sustentada por evidencia directa.
- **Información del proveedor:** el catálogo local enlaza fuentes oficiales
  de privacidad, tratamiento y condiciones para cada proveedor conocido. El
  informe atribuye las afirmaciones al proveedor, usa lenguaje llano y enlaza
  la fuente oficial saneada. El auditor puede consultar políticas y términos
  que el propio sitio enlaza públicamente, incluso si están alojados en otro
  dominio, con los límites de egress indicados abajo. No presenta una
  declaración del proveedor como verificación de una práctica interna.
- Los documentos públicos se leen en el auditor de egress aislado. Solo se
  admiten HTTPS en puerto 443, DNS/IP públicos validados, GET sin credenciales,
  cookies ni Referer, respuestas acotadas y redirecciones seguras. No se siguen
  enlaces arbitrarios desde páginas de proveedor: el destino debe proceder de
  un enlace público identificado o del catálogo local revisado. Se respetan
  los límites existentes de 120 segundos, 300 solicitudes, 20 MiB recibidos y
  30 páginas por análisis; no se amplían por esta feature.
- El catálogo local de proveedores y reglas conserva versión, fuente oficial,
  fecha de revisión, licencia/condiciones de uso, confianza y falsos positivos
  conocidos. No se consulta una base de conocimiento remota durante un análisis.
- Si el sitio o proveedor devuelve una denegación explícita, una página legal
  exigible está ausente, o una declaración necesaria no cubre un servicio
  observado, se registra un hallazgo público. Un fallo técnico del auditor,
  catálogo/parser o límite interno queda en «En revisión», sin penalización ni
  atribución al dominio.

## Estados públicos

- **Correcto:** todos los servicios externos confirmados que se observaron
  están identificados por el sitio con proveedor y finalidad/servicio. Las
  menciones no observadas no alteran el resultado.
- **Riesgo detectado:** se observó un servicio sin declaración identificable
  del proveedor y su finalidad, o faltó información pública exigible para
  entenderlo. El texto explica la consecuencia para la persona usuaria, sin
  atribuir falsedad o incumplimiento contractual no demostrado.
- **Ilegalidad detectada:** solo cuando una regla local versionada identifica
  una norma europea aplicable, su artículo concreto, una práctica expresamente
  prohibida y la señal directa y reproducible que demuestra esa práctica. La
  ficha muestra la norma y el artículo. Un indicio, un host desconocido o una
  cláusula ambigua no bastan; en esos casos se informa «Riesgo detectado» o se
  deja la parte realmente bloqueada en revisión.
- **En revisión:** exclusivamente una limitación/error técnico atribuible al
  auditor que impide completar la observación. No usar «En revisión» para
  ocultar una falta pública comprobable.

La evaluación pública de servicios externos es común a todos los dominios,
incluidos Grumphya y Desarrollo Seguro. Mantiene el mismo peso ya acordado en
la nota ética y aporta el mismo criterio público. El inventario backend firmado
de los clientes se publica aparte como transparencia adicional; nunca hace
subir ni bajar esta comparación común.

## Presentación del informe

- La sección común se titula **«Servicios externos detectados»** y muestra
  proveedores observados, declaración del sitio, función indicada y fuente
  oficial del proveedor, con estados «Correcto», «Riesgo detectado» o
  «Ilegalidad detectada».
- No se muestran categorías genéricas inferidas por palabras sueltas,
  contadores internos de páginas/enlaces ni mensajes «No se detectaron
  problemas» en las tarjetas de dimensiones.
- En informes de clientes autorizados, el inventario privado se presenta en
  otro bloque que explica que el titular decidió compartir información
  adicional de su aplicación. No muestra la fecha de la auditoría otra vez ni
  se mezcla con la comparación pública.
- Junto al gráfico circular de puntuación global, a su derecha, se muestra un
  resumen determinista y en lenguaje llano: lectura general, fortalezas y los
  riesgos de mayor impacto. No repite métricas que aparecen en otras partes ni
  da consejos a desarrolladores.
- La ficha no expone errores técnicos del auditor como hallazgos del dominio.
  Los errores propios reales dejan el criterio «En revisión» y se corrigen en
  el auditor antes de atribuirlos al sitio.
- En móvil, el espacio horizontal exterior y de los contenedores de contenido
  se reduce a 10 px, evitando el acolchado acumulado de contenedores anidados.
- Se conserva SCSS, accesibilidad, contraste, teclado/lector, diseño
  adaptable y `prefers-reduced-motion`. La ficha pública no carga recursos ni
  comunica datos a los proveedores citados; los enlaces externos solo se
  contactan cuando una persona los abre.

## Secuencia de trabajo acordada

1. Corregir evidencia pública y evaluación común de servicios, sus fuentes de
   proveedor y estados, preservando errores reales del auditor como revisión.
2. Rehacer los bloques de servicios para mostrar la comparación pública común
   y separar la evidencia interna adicional de clientes certificados; retirar
   contradicciones y trazas técnicas redundantes.
3. Cambiar la cabecera para colocar el gráfico a la izquierda y un resumen
   comprensible a la derecha.
4. Ajustar el acolchado horizontal móvil a 10 px y verificar la ficha completa.

## Criterios de aceptación

1. Un mismo informe/política puntúa el criterio público de servicios con la
   misma regla en cualquier dominio, incluido un cliente certificado.
2. Servicio observado y declarado con proveedor y finalidad/función =
   «Correcto»; servicio observado sin esa declaración = «Riesgo detectado» y
   penaliza el peso público acordado.
3. Servicio declarado no observado no penaliza; uso declarado ilegal solo se
   rotula así con regla legal explícita y evidencia directa.
4. Cada servicio conocido enlaza a la información oficial pública del
   proveedor y resume afirmaciones del catálogo local revisado, atribuidas y
   en lenguaje llano; los enlaces externos de privacidad o condiciones
   publicados por el sitio se consultan bajo los límites de egress vigentes.
5. Una fuente ausente o explícitamente inaccesible que deba ser pública es un
   riesgo de transparencia; un error técnico atribuible al auditor queda en
   revisión y no se publica como problema del dominio.
6. El inventario privado de clientes certificados aparece en un bloque
   separado y no modifica la puntuación pública común.
7. Las tarjetas no contienen «No se detectaron problemas…» ni categorías
   genéricas no vinculadas a servicios concretos. Se eliminan fechas repetidas
   y contadores de crawler que no ayuden al usuario.
8. El resumen inicial se entiende sin conocimientos técnicos, ocupa el lado
   derecho del gráfico y explica puntos favorables y riesgos reales sin
   repetir notas ya mostradas.
9. En viewport móvil, el gutter horizontal efectivo del informe no supera
   10 px por lado por acumulación de contenedores.
10. Pruebas cubren comparaciones coincidentes/missing/unobserved, una regla
    legal directa y un indicio que no basta, aislamiento de evidencia cliente,
    copy, resumen, errores ocultos, accesibilidad y viewport móvil.

## Verificación

- Ejecutar pruebas locales de core, worker, persistencia, API, componentes y
  navegador; integración PostgreSQL, auditoría de SonarQube local y gates CI.
- Lighthouse conserva los umbrales establecidos en
  `lighthouse-laboratory.md`; SEO es informativo mientras `/app/` mantenga
  `noindex`.
- Solo después de gates verdes, integrar en `main`, desplegar Desarrollo
  Seguro y comprobar los health checks, análisis público y reporte de origen.
- Documentar en `doc/` el criterio y la lectura pública terminada. Retirar de
  `wanna-bes.md` cualquier idea implementada que corresponda.
