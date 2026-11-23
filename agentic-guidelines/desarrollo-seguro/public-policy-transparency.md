# Transparencia pública sobre servicios externos

## Objetivo

Valorar si un sitio identifica públicamente los servicios externos que usa y
explica sus propósitos y destinatarios. La comprobación promueve transparencia
comprensible para visitantes; no afirma conocer contratos privados ni prácticas
que la evidencia pública no permita observar.

## Alcance

- Aplicar al perfil público de todos los dominios y mostrar por separado la
  declaración pública y las señales técnicas observadas. En clientes, el
  inventario interno autenticado decide `DS-PRIV-04`; la evaluación pública se
  conserva como contexto visible y no sustituye un inventario ausente o fallido.
- `domain-ethics-v4` define `DS-PRIV-04` exclusivamente como transparencia del
  inventario backend autenticado. `domain-ethics-v5` conserva su peso de 10
  puntos y usa esa evidencia firmada para clientes; para no clientes usa la
  evidencia de transparencia pública definida aquí. Los informes históricos
  conservan `v4` y su interpretación.
- Inspeccionar la respuesta inicial del sitio y seguir únicamente enlaces HTTPS
  visibles a páginas de privacidad, cookies, condiciones o información legal.
- No ejecutar formularios, iniciar sesión, aceptar condiciones ni enviar datos
  personales. Solo se permiten solicitudes GET necesarias para leer estas
  páginas.
- No rastrear enlaces dentro de las políticas ni ampliar la búsqueda a otros
  sitios por palabras clave. Los enlaces de política encontrados en la página
  inicial son el conjunto máximo de destinos.
- No guardar cuerpos, textos, URLs completas, consultas, fragmentos, cookies ni
  datos personales. El informe solo recibe contadores, estados y categorías de
  información detectadas por el catálogo local versionado.

## Límites de red y seguridad

- Usar el broker de egreso aislado existente; nunca hacer estas solicitudes
  desde el worker general ni desde la API.
- Permitir solo HTTPS público en puerto 443. Validar DNS/IP en cada conexión y
  redirección; bloquear IP privadas, loopback, link-local, metadatos, gateway,
  puertos no autorizados y cambios de host no incluidos en los enlaces
  inicialmente observados.
- Máximo por análisis: 120 segundos agregados, 300 solicitudes HTTP(S), 20 MiB
  recibidos, 30 páginas/proveedores relevantes y 8 contextos efímeros. La
  comprobación de políticas debe respetar esos topes y puede tener topes
  menores. Al agotarlos, dejar la evidencia pendiente como `unknown` sin
  penalización.
- Limitar cada documento a 64 KiB de texto inspeccionable y hasta 3
  redirecciones, que deben permanecer en el mismo host público.
- No transmitir a terceros la URL de la página auditada en el `Referer`.
  Desactivar cookies y credenciales en estas solicitudes.

## Resultado y clasificación

- `pass`: la página inicial y los enlaces pertinentes se pudieron inspeccionar,
  la declaración incluye información sobre servicios externos y sus
  propósitos/destinatarios, y las categorías se identificaron dentro del
  catálogo local.
- `fail`: la inspección inicial terminó correctamente y no hay enlace público a
  políticas pertinentes; la política enlazada está ausente, vacía o no informa
  sobre servicios externos y sus propósitos; o el sitio deniega explícitamente
  el acceso al contenido (por ejemplo, 403/451, desafío anti-bot o mensaje
  inequívoco de bloqueo). Se describe como información pública insuficiente o
  acceso denegado, sin afirmar incumplimientos legales no demostrados.
- `unknown`: el auditor sufre un error propio (DNS/egreso, TLS, timeout, límite,
  formato no procesable por una limitación del lector, o fallo del navegador).
  El informe queda «En revisión» y no atribuye el error al dominio. Una falta de
  información que el lector pudo comprobar y una denegación explícita no son
  errores del auditor y se clasifican como `fail`.
- La evaluación pública de `DS-PRIV-04` debe quedar evaluada (`pass` o `fail`)
  cuando el lector haya procesado correctamente la página inicial y sus
  enlaces. Una categoría que el sistema no puede reconocer por una limitación
  conocida del catálogo o del parser es un error del auditor: se informa como
  `unknown` hasta corregir esa limitación; nunca se transforma en una
  afirmación legal sobre el dominio.
- Una política encontrada no demuestra que sus declaraciones sean verdaderas.
  El informe distingue lo que el titular declara de las señales observadas.
  Solo evidencia pública contradictoria y reproducible puede indicar una
  declaración inconsistente.
- Un `pass` significa que hay información pública identificable, no certifica
  legalidad, calidad contractual ni las prácticas internas de proveedores.

## Catálogo y evidencia

- Usar un catálogo local versionado y revisado con frases/categorías para
  destinatarios, propósitos y denegaciones de acceso. Registrar fuente, URL,
  fecha, licencia y confianza en el propio catálogo.
- El texto de baja confianza es indicio, no `fail`; no penaliza sin una señal
  catalogada y reproducible.
- Persistir solo el identificador de catálogo, número de enlaces/páginas
  pertinentes, categorías detectadas y estados agregados. No persistir el texto
  ni las URLs descubiertas.

## Diagnóstico acotado del auditor

- Cuando una sonda de página falla, conservar únicamente el código de error
  seguro de la lista cerrada del transporte (`dns_resolution_failed`,
  `connection_failed`, `request_timeout`, `response_size_limit_exceeded`,
  `tls_certificate_invalid`, `tls_handshake_failed`, `broker_failed` y los
  demás códigos ya admitidos por el broker). No guardar el texto de excepciones,
  direcciones, URLs, cabeceras, cuerpos ni contenido de cookies.
- Adjuntar el código como evidencia opcional a los controles de la portada que
  dependen de esa sonda. Un fallo del auditor mantiene el control `unknown` y
  la ficha «En revisión»; nunca se convierte en un fallo atribuible al dominio.
- El contrato del trigger PostgreSQL y la proyección pública deben admitir ese
  campo enum y el resumen exacto correspondiente. Un campo admitido solo por
  TypeScript no cuenta como evidencia persistida.
- El resumen público debe explicar en lenguaje sencillo que el lector tuvo un
  problema y describir la causa acotada cuando exista. La validación de CI debe
  poder distinguir ese diagnóstico de un `unknown` sin explicación.

## Criterios de aceptación

1. El control diferencia declaración pública encontrada, información ausente,
   denegación explícita y error propio del auditor.
2. Los enlaces externos de política se consultan solo desde el broker aislado,
   con destinos públicos HTTPS validados y los límites indicados.
3. Ninguna respuesta persiste contenido crudo o URLs externas.
4. El informe en lenguaje llano explica qué declara el sitio, qué encontró el
   auditor y qué no puede demostrar.
5. Tests cubren ausencia, declaración identificada, 403/451, desafío explícito,
   timeout, redirección a host distinto/privado, límites, respuesta grande y
   sanitización de evidencia.
6. `domain-ethics-v5` mantiene los 10 puntos de `DS-PRIV-04`; usa inventario
   backend autenticado en clientes y evaluación pública en no clientes. No
   altera `domain-ethics-v4`, sus informes históricos ni el estado de
   certificación.
7. Un fallo de una sonda GET conserva solo un código de error acotado, visible
   en la evidencia persistida y acompañada por un resumen seguro; el trigger y
   la vista pública aceptan y proyectan el mismo contrato. El estado sigue
   `unknown` y no incluye datos del destino.

La presentación pública separa lo que declara el titular de las señales observadas. Solo una diferencia reproducible permite describir una discrepancia; el contenido de políticas no se publica literalmente.
