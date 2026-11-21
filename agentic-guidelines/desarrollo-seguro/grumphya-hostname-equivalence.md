# Equivalencia de hostnames de Grumphya

## Alcance

Resolver `grumphya.com` y `www.grumphya.com` como una misma identidad de análisis y de sello solo cuando el escáner haya observado y validado una cadena de redirección HTTP permanente entre ambos. La dirección canónica se deriva de la evidencia, nunca de una preferencia fija ni de una transformación textual. No se modifica el repositorio de Grumphya en esta capacidad.

## Comportamiento

- Conservar para cada informe el hostname solicitado y una evidencia acotada de la redirección: estados HTTP, hostnames de origen/destino y resultado de validación. No conservar URLs, cabeceras ni cuerpos crudos.
- Solo 301 y 308 prueban permanencia. 302, 303 y 307 pueden seguirse para la observación HTTP existente, pero no establecen equivalencia.
- Mantener el límite actual de redirecciones, la validación DNS/IP pública fijada por conexión, HTTPS, rutas permitidas y controles anti-SSRF. Permitir cambio de hostname únicamente dentro del par exacto `grumphya.com` / `www.grumphya.com`; rechazar otros destinos.
- La cadena debe ser completa, acíclica, permanecer en el par autorizado y terminar en una respuesta que no redirige. La redirección permanente validada basta para identificar el destino al que llega la persona; no se comparan puntuaciones ni contenidos de dos análisis para decidir equivalencia. Si no hay cadena permanente demostrada (incluidos respuestas independientes), ambos hostnames conservan informes separados.
- Cuando se demuestra equivalencia, asociar las lecturas de ambos alias a la identidad e informe vigente del hostname final observado. Mostrar la redirección como evidencia del informe. No copiar puntuaciones entre informes separados ni tratar una redirección o un error como una puntuación perfecta.
- Emitir el sello para la identidad canónica resuelta con certificación activa. El token dura 30 días y puede revocarse. En cada visita el widget obtiene `certifiedReportId` desde `GET /domains/:hostname/status`; un UUID estático del embed no es autoritativo. La API verifica que el ID enviado sea el informe certificado vigente, fresco y activo, y devuelve ese ID para la ficha oficial. Una renovación elegible mueve la verificación del mismo token al nuevo informe sin editar el snippet. Suspensión, informe vencido, revocación, vencimiento del token o pérdida de evidencia de redirección ocultan el sello.
- Los fallos de verificación generan diagnósticos categóricos seguros (`hostname_not_authorized`, `report_not_current`, `badge_expired`, `badge_revoked`, `redirect_not_valid`, `network_failure`); nunca se registran ni exponen tokens.
- La allowlist de `Origin` sigue describiendo sitios autorizados para incrustar el widget, separada de la identidad del hostname analizado. Solo cambia si evidencia del alojamiento real lo requiere.

## Límites

No se elimina `www` por regla de texto, no se aceptan hostnames parecidos y no se usa redirección temporal para fusionar identidades. No se relajan restricciones de salida, DNS, puertos, rutas o cantidad de redirecciones. No se activa el sello por puntuación sola. El contrato del consumidor de Grumphya se entrega en conversación; su implementación queda fuera de este repositorio y tarea.

## Criterios de aceptación

1. Una cadena validada `www` → raíz mediante 301/308 resuelve ambas entradas a la raíz; la cadena raíz → `www` resuelve ambas a `www`.
2. 302/303/307, ausencia de redirección, bucle, límite excedido, fallo de red, destino ajeno, cadena incompleta o contenido independiente no fusionan informes.
3. La persistencia y proyección conservan hostname solicitado y evidencia segura; informes no equivalentes mantienen sus resultados independientes.
4. El alias resuelto accede al mismo informe certificado vigente, y emisión/verificación del sello aplican también revocación, caducidad, elegibilidad y `Origin` existentes.
5. La verificación devuelve diagnósticos seguros distinguibles y no incluye el token en URL, logs ni errores.
6. Pruebas cubren transporte, normalización/equivalencia, persistencia, emisión/verificación y presentación. La política DNS/IP, SSRF, límites y allowlist del navegador no se debilita.
