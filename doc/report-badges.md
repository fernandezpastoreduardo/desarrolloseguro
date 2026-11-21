# Sello verificable de informe

El API puede emitir un identificador aleatorio de 256 bits ligado al informe certificado vigente de `grumphya.com` con perfil `domain-v1`, `domain-v2` o `domain-v3` (el perfil activo actual es `domain-v3`). Solo guarda su SHA-256. Cada sello dura 30 días, puede revocarse y desaparece si la política de retención elimina el informe. No se emite desde datos de muestra, desde un informe pendiente o desde un informe bloqueado.

La certificación beta se persiste por dominio (`pending`, `active` o
`suspended`). La emisión y la verificación requieren una certificación
`active` y que `report_id` coincida con `certified_report_id`; los informes
históricos no generan un sello verificable. Una suspensión oculta
automáticamente el sello y una evaluación elegible posterior lo reactiva sin
cambiar el dominio autorizado.

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
node scripts/issue-report-badge.mjs <uuid-del-informe-real>
```

El helper valida el UUID, lee la clave solo desde el archivo privado y muestra la respuesta pública de emisión. La API guarda solo SHA-256 del token aleatorio; conserva el token y `verifyUrl` de la salida para el embed. No se puede recuperar después. La emisión acepta cualquiera de los dos hostnames y resuelve el informe vigente del hostname canónico. Se rechaza si el ID no es el informe certificado vigente o no pertenece a un informe del perfil de análisis de dominio.

La emisión se autoriza con el secreto que solo conserva el VPS:

```http
POST /api/desarrollo-seguro/v1/badges
Authorization: Bearer <DS_BADGE_ISSUER_TOKEN>
Content-Type: application/json

{"hostname":"grumphya.com","reportId":"<uuid-del-informe-real>"}
```

La respuesta contiene `hostname`, `canonicalHostname`, `reportId`, `token`, `verifyUrl` y `expiresAt`. Conserva el token devuelto; no se puede recuperar después.

## Verificación desde la página pública y el sitio

`verifyUrl` abre `/desarrollo-seguro/verificar.html`. El token va en el fragmento `#` de la URL, que no se envía al servidor al abrir la página. El verificador consulta `POST /api/desarrollo-seguro/v1/badges/verify` con `cache: "no-store"`; el token está en el cuerpo de la solicitud y no aparece en el access log. Muestra dominio e ID con `textContent` y enlaza a la vista humana `/app/?report=<reportId>`, el formato que consume el buscador. La página usa `noindex`, `nofollow` y `no-referrer`.

La comprobación es un `POST` con el token en el cuerpo JSON, por lo que no aparece en la URL ni en los access logs. La API comprueba que el informe siga existiendo y sea el certificado vigente, que el sello no haya caducado ni se haya revocado, que la identidad del alias tenga evidencia reciente y que el origen sea el sitio autorizado. Una respuesta fallida incluye un código seguro (`hostname_not_authorized`, `report_not_current`, `badge_expired`, `badge_revoked`, `redirect_not_valid` o `network_failure`); los diagnósticos no incluyen tokens.

Para incluirlo en `grumphya.com`, usa el `token` y `reportId` devueltos por la emisión. Este widget solo revela el enlace cuando la respuesta del servidor es válida desde el origen autorizado. Si se copia a otro dominio, el navegador envía el origen de ese dominio y la comprobación falla de forma cerrada:

```html
<a data-ds-verified-badge
   data-token="TOKEN_EMITIDO"
   data-hostname="grumphya.com"
   data-report-id="UUID_DEL_INFORME"
   hidden>Comprobando sello…</a>
<script src="https://desarrolloseguro.org/desarrollo-seguro/badge-widget.js" defer></script>
```

La política CSP del sitio que incrusta debe permitir el script `https://desarrolloseguro.org` y las conexiones `connect-src https://desarrolloseguro.org`.

El API permite CORS solo desde `https://grumphya.com` y `https://desarrolloseguro.org`. En la página de Desarrollo Seguro, el navegador realiza una petición same-origin; el servidor acepta esa solicitud con `Sec-Fetch-Site: same-origin` cuando el navegador omite `Origin`. Un origen distinto o una respuesta de red fallida no muestra el sello.

## Revocación

```http
POST /api/desarrollo-seguro/v1/badges/revocation
Authorization: Bearer <DS_BADGE_ISSUER_TOKEN>
Content-Type: application/json

{"token":"<token-del-sello>","hostname":"grumphya.com","reportId":"<uuid-del-informe-real>"}
```

El endpoint de verificación comprueba `Origin` o los metadatos same-origin del navegador como defensa para incrustación web. No pretende autenticar clientes HTTP que falsifiquen cabeceras fuera del navegador; el sello no es certificado de seguridad ni sustituye la consulta del informe completo.
