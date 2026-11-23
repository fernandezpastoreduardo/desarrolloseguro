# Transparencia pública sobre servicios externos

## Propósito

Dar a las personas una evaluación pública entendible de qué servicios externos
se observan, qué declara el sitio y qué falta por explicar. La ausencia de
información pública exigible cuenta como un fallo de transparencia. Un fallo
técnico del auditor queda en revisión y no se atribuye al dominio.

## Fuentes y alcance

- Para `grumphya.com` y `desarrolloseguro.org`, usar el inventario interno
  autenticado, firmado y vigente descrito en
  [backend-processor-transparency.md](backend-processor-transparency.md).
- Para cualquier otro dominio, revisar la portada y seguir sus enlaces HTTPS
  que identifiquen políticas de privacidad, cookies, condiciones o información
  legal. Si la política del sitio enlaza a políticas públicas de proveedores,
  el auditor puede consultarlas también.
- La base local de proveedores y términos es versionada, revisada y limitada a
  fuentes con licencia aprobada. Se usa para localizar menciones, no para
  declarar por sí sola ilegal o engañosa una práctica.
- La información obtenida de los documentos se distingue de las conexiones y
  cookies vistas en el navegador. No se ejecuta JavaScript para esta lectura,
  no se envían formularios y no se presentan secretos ni datos personales.
- El auditor solo consulta HTTPS por puerto 443, aplica resolución pública
  fijada a la conexión, valida cada destino y limita redirecciones. No sigue
  hosts obtenidos de la URL de entrada, solo destinos derivados de enlaces
  públicos revisados en el documento.

## Resultado

- `pass`: hay una política pública accesible y sus declaraciones incluyen los
  servicios observados o categorías de destinatarios, los fines de uso y las
  referencias pertinentes a proveedores dentro del alcance comprobado. Una
  política puede declarar que no hay proveedores externos; el análisis muestra
  esa declaración como tal y no presume que sea falsa.
- `fail`: falta la política o información pública exigible; un proveedor
  observado no aparece en la información publicada; o el sitio que aloja la
  documentación deniega explícitamente el acceso al auditor (incluye HTTP 403,
  429 o una página de bloqueo/CAPTCHA). El hallazgo habla de transparencia y no
  afirma una infracción contractual no observada.
- `unknown` / «En revisión»: un error técnico del auditor, de DNS/TLS/egress, una
  respuesta incompleta o el agotamiento de su presupuesto impide terminar la
  revisión, sin una denegación explícita del sitio. Se omite del cálculo y
  reduce la cobertura visible.

## Privacidad, seguridad y presupuestos

- Presupuesto inicial del crawler documental en `domain-v4`: máximo 30
  documentos, 45 solicitudes documentales y 3.500.000 bytes recibidos, con
  cuatro descargas simultáneas. El presupuesto total de transporte para este
  perfil es de 120 segundos, 64 solicitudes HTTP(S) y 4 MiB; prevalece el
  primero que se agote. La auditoría web de Solistos tiene límites distintos y
  no forma parte de este cambio. El agotamiento sin denegación explícita deja
  lo pendiente `unknown`, nunca `fail`.
- No persistir ni mostrar cuerpos HTML, contenido íntegro de políticas, query,
  fragmentos, credenciales, IP o datos personales.
- La evidencia persistida contiene solo estados, contadores, booleanos y
  versión del catálogo. No persiste nombres de proveedores observados ni URL,
  ruta, host, texto o cuerpo de los documentos.
- No conservar declaraciones textuales de políticas en el informe. La UI usa
  una explicación propia y en lenguaje llano para evitar publicar contenido
  ajeno o atribuir más de lo observado.

## Presentación pública

- Mostrar dos bloques: «Lo que declara el sitio» y «Lo que observamos desde
  fuera».
- Enumerar proveedores/dominios observados cuando la evidencia los incluya.
- Explicar la consecuencia para las personas en lenguaje llano; no ofrecer una
  lista de tareas para desarrolladores.
- Indicar que una declaración es del titular. Solo evidencia observada que la
  contradiga permite describir una discrepancia; una declaración no prueba que
  un tercero cumpla sus condiciones.
- No presentar «Sin conclusión» como estado final. Un hallazgo confirmado es
  `pass` o `fail`; la única falta de resultado es «En revisión» por error propio
  de auditoría o por presupuesto agotado.

## Criterios de aceptación

1. Solo se siguen enlaces HTTPS públicos a documentos de privacidad, cookies,
   condiciones o información legal, incluidos enlaces a proveedores hallados
   en esos documentos, con destinos validados dentro del egress sandbox.
2. El crawler no acepta un host, URL o ruta arbitrarios del caller por el
   socket IPC.
3. La clasificación separa ausencia/denegación explícita de errores propios
   del auditor y respeta el presupuesto agregado.
4. La evidencia pública diferencia la declaración del titular de señales
   observadas y no guarda cuerpos ni datos personales. La política del titular
   solo se trata como declaración; no se presume cierta ni falsa por sí sola.
5. Las declaraciones que no coinciden con señales observadas se describen como
   discrepancias; no se llaman mentiras ni se infiere incumplimiento contractual.
6. Cada informe conserva la versión de rúbrica y del catálogo que usó; los
   informes históricos no cambian al actualizar reglas.
7. Pruebas cubren links maliciosos (SSRF, credenciales, puertos, HTTP, redirect
   loops), páginas ausentes/bloqueadas, errores de red, catálogos y cobertura
   parcial, persistencia allowlisted y lenguaje público.
