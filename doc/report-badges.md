# Sello verificable de informe

El API puede emitir un identificador aleatorio de 256 bits para `grumphya.com`, `www.grumphya.com` o `desarrolloseguro.org`, con perfil `domain-v1`, `domain-v2`, `domain-v3` o `domain-v4` (el perfil activo actual es `domain-v4`). Solo guarda su SHA-256. Cada sello dura 30 días y puede revocarse. Al emitirlo se exige una certificación `active` con informe certificado vigente. El token no se fija al UUID de ese primer informe: en cada verificación se comprueba el `certifiedReportId` actual. Una renovación elegible mantiene el mismo sello; una certificación suspendida, un informe vencido, la revocación o el vencimiento del token lo ocultan. No se emite desde datos de muestra, desde una identidad sin informe certificado vigente o desde un informe bloqueado.

La certificación beta se persiste por dominio (`pending`, `active` o
`suspended`). La emisión requiere una certificación `active`; la verificación
resuelve el informe vigente desde el estado público y comprueba que su ID
coincida con `certified_report_id`. Los informes históricos nunca se presentan
como vigentes. Una suspensión oculta automáticamente el sello y una evaluación
elegible posterior lo reactiva sin cambiar el dominio autorizado ni el snippet
del sitio.

En el portal de informes, la tarjeta de estado de certificación beta solo se
muestra para los clientes actuales `grumphya.com` y `desarrolloseguro.org`.
Las auditorías de otros dominios no presentan estados de certificación.

El scheduler de certificaciones comprueba cada cinco minutos si hay auditorías
que llevan 40 minutos pendientes. Solo las auditorías programadas reutilizan
informes de menos de 40 minutos; las solicitudes manuales mantienen la política
actual de Beta, sin caché ni enfriamiento. Esto deja margen para renovar el
informe antes de su caducidad y evita añadir hasta otra hora de espera.
Tras completarse una auditoría elegible, la verificación del token ya instalado
resuelve el nuevo informe certificado y conserva el sello sin volver a emitir
otro token. Mientras el escaneo está en cola o ejecutándose, o si el informe
vence antes de completarse, el widget lo oculta hasta que exista un informe
fresco; una suspensión real también lo oculta.

`grumphya.com` y `www.grumphya.com` usan la misma identidad solo si un informe
reciente observó una cadena completa de redirección permanente 301/308 entre
ambos nombres y el escáner validó todos sus destinos. El destino observado es
el hostname canónico; no se presupone que gane el dominio raíz. El informe
conserva el hostname solicitado y los campos acotados del salto. El portal
muestra esa evidencia y, si existe, presenta el informe certificado vigente
del destino. Una redirección temporal, un destino ajeno, una cadena inválida o
evidencia vencida no fusionan identidades.

## Emisión

El deploy genera una clave aleatoria local en `/opt/desarrollo-seguro/secrets/development_security_badge_issuer_token` si no existe y la monta solo en el API de Desarrollo Seguro. El archivo es de `root` y modo `0400`; el secreto no se entrega a GitHub, al navegador ni a Grumphya.

Para emitir desde el checkout de Desarrollo Seguro en el VPS, ejecuta el helper como `root` con el UUID de un informe real:

```sh
node scripts/issue-report-badge.mjs <uuid-del-informe-real> [hostname]
```

El helper valida el UUID, lee la clave solo desde el archivo privado y muestra la respuesta pública de emisión. La API guarda solo SHA-256 del token aleatorio; conserva el token y `verifyUrl` de la salida para el embed. No se puede recuperar después. La emisión acepta `grumphya.com`, `www.grumphya.com` o `desarrolloseguro.org` y resuelve la identidad del hostname canónico. Se rechaza si no hay una certificación activa con informe vigente o si el hostname no pertenece al perfil de análisis de dominio. El UUID devuelto identifica el informe vigente al emitir; no debe fijarse en el embed. Para el sello del footer de Desarrollo Seguro, sustituye el atributo `data-token` vacío de las páginas públicas por el token emitido para `desarrolloseguro.org`.

La emisión se autoriza con el secreto que solo conserva el VPS:

```http
POST /api/desarrollo-seguro/v1/badges
Authorization: Bearer <DS_BADGE_ISSUER_TOKEN>
Content-Type: application/json

{"hostname":"grumphya.com","reportId":"<uuid-del-informe-real>"}
```

La respuesta contiene `hostname`, `canonicalHostname`, `reportId`, `token`, `verifyUrl` y `expiresAt`. Conserva el token devuelto; no se puede recuperar después.

## Verificación desde la página pública y el sitio

`verifyUrl` abre `/desarrollo-seguro/verificar.html`. El token va en el fragmento `#` de la URL, que no se envía al servidor al abrir la página. El verificador lo lee y elimina el fragmento del historial del navegador antes de hacer peticiones. Consulta primero `GET /api/desarrollo-seguro/v1/domains/<hostname>/status` y obtiene `lastReport.certification.certifiedReportId`; después consulta `POST /api/desarrollo-seguro/v1/badges/verify` con `cache: "no-store"`. El token solo va en el cuerpo de la petición de verificación. Si la API confirma el sello, la página muestra el estado de autenticidad y solicita el informe público para presentar dominio, veredicto, certificación beta, puntuación, categorías, fecha, alcance y caducidad. El enlace abre `/app/?report=<reportId>`, el formato que consume el buscador. Si la autenticidad falla, no se muestran el resumen ni el enlace al informe. La página usa `noindex`, `nofollow` y `no-referrer`.

La comprobación es un `POST` con el token en el cuerpo JSON, por lo que no aparece en la URL ni en los access logs. La API comprueba que el `reportId` recibido sea el `certifiedReportId` vigente, que la certificación esté activa, que el informe certificado no haya caducado, que el sello no haya caducado ni se haya revocado, que la identidad del alias tenga evidencia reciente y que el origen sea el sitio autorizado. Una respuesta fallida incluye un código seguro (`hostname_not_authorized`, `report_not_current`, `badge_expired`, `badge_revoked`, `redirect_not_valid` o `network_failure`); el widget conserva ese código como diagnóstico DOM y mantiene el enlace oculto. Los diagnósticos no incluyen tokens.

Para incluirlo en `grumphya.com`, usa el `token` devuelto por la emisión. El widget remoto resuelve el informe actual; `data-report-id` es opcional y no debe quedar codificado en el sitio. El widget solo revela el enlace cuando el estado público es `fresh` o `updating`, la certificación está activa y la verificación del servidor confirma que el informe certificado sigue fresco. Si se copia a otro dominio, el navegador envía el origen de ese dominio y la comprobación falla de forma cerrada:

```html
<a data-ds-verified-badge
   data-token="TOKEN_EMITIDO"
   data-hostname="grumphya.com"
   hidden>Comprobando sello…</a>
<script src="https://desarrolloseguro.org/desarrollo-seguro/badge-widget.js" defer></script>
```

La política CSP del sitio que incrusta debe permitir el script `https://desarrolloseguro.org` y las conexiones `connect-src https://desarrolloseguro.org`.

El servidor entrega `Cross-Origin-Resource-Policy: cross-origin` únicamente
para `/desarrollo-seguro/badge-widget.js`, porque el sitio que lo incrusta
puede aplicar COEP `require-corp`. El resto del sitio mantiene sus cabeceras
actuales. La respuesta del widget usa `Cache-Control: no-store` para que el
navegador cargue siempre su versión vigente.

El widget genera la insignia compacta con el logo aprobado y estilos Sass
incluidos en el propio script. El logo SVG se entrega mediante una URL `blob:`
para que pueda mostrarse bajo la CSP de Grumphya, que permite imágenes `blob:`
pero no imágenes externas. La insignia aparece solo después de verificar el
sello; enlaza a la página pública anterior. En el sitio de Desarrollo Seguro,
el helper de verificación se empaqueta dentro de `verificar.js` durante el
build, de modo que la CSP con hashes y SRI controla un solo script de entrada.

El API permite CORS solo desde `https://grumphya.com` y `https://desarrolloseguro.org`. En la página de Desarrollo Seguro, el navegador realiza una petición same-origin; el servidor acepta esa solicitud con `Sec-Fetch-Site: same-origin` cuando el navegador omite `Origin`. Un origen distinto o una respuesta de red fallida no muestra el sello.

## Revocación

```http
POST /api/desarrollo-seguro/v1/badges/revocation
Authorization: Bearer <DS_BADGE_ISSUER_TOKEN>
Content-Type: application/json

{"token":"<token-del-sello>","hostname":"grumphya.com","reportId":"<uuid-del-informe-real>"}
```

El endpoint de verificación comprueba `Origin` o los metadatos same-origin del navegador como defensa para incrustación web. No pretende autenticar clientes HTTP que falsifiquen cabeceras fuera del navegador; el sello no es certificado de seguridad ni sustituye la consulta del informe completo.
