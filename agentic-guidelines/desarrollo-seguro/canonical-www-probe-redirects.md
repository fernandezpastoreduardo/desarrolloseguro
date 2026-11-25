# Redirecciones canónicas `www` en análisis públicos

## Alcance

Las sondas HTTP y HTTPS de los análisis públicos deben seguir una redirección
entre el hostname solicitado y su único alias literal con prefijo `www.`. Esto
permite medir la página canónica, en lugar de puntuar la respuesta de redirección
como si fuera el contenido del sitio. El cambio no fusiona la identidad, el
historial ni la caché de otros hostnames; la resolución de alias de informes
existente para Grumphya conserva sus reglas propias.

## Límites y comportamiento

- Se permite solo el par exacto `example.test` / `www.example.test`; no se
  infiere un dominio registrable, no se siguen subdominios arbitrarios y no se
  permite otro hostname, esquema, puerto o credencial.
- Los redirects continúan sujetos a los límites de saltos, tiempo, DNS fijado,
  validación TLS, rutas permitidas y política de egress del scanner.
- Las sondas pueden seguir códigos HTTP de redirección ya admitidos; solo una
  redirección permanente 301/308 entre el par exacto conserva la condición
  existente para declarar hostname canónico en los informes de Grumphya.
- Ética, privacidad estática, rastreadores y rendimiento usan las señales de la
  página HTML final alcanzada dentro de ese par. Si no se puede leer la página
  final, el control permanece sin evaluar con su evidencia de error; no se
  puntúa el cuerpo HTML de un 301 como la página auditada.
- El navegador aislado y las comprobaciones legales existentes conservan sus
  fases y evidencia. Este cambio no altera sus reglas ni afirma que una petición
  bloqueada se haya transmitido.

## Criterios de aceptación

1. Un 301/308 de `example.test` a `www.example.test` y en sentido inverso lleva
   las sondas permitidas al recurso final con el mismo path autorizado.
2. No se siguen redirects a otro hostname, a puertos distintos de 443, a HTTP,
   ni a rutas fuera del alcance.
3. La respuesta final HTML permite producir evidencias estáticas de privacidad,
   rastreadores y rendimiento; la respuesta del redirect por sí sola no genera
   contadores de contenido del sitio.
4. Las reglas existentes de identidad del informe Grumphya permanecen sin
   cambios.
5. Las pruebas cubren aliases en ambos sentidos, redirects no permanentes
   permitidos para observación, rechazos de destinos ajenos y el flujo HTTP a
   HTTPS con alias.
6. La versión del scanner se incrementa para distinguir estas mediciones de
   los informes anteriores que puntuaron la respuesta del redirect.
