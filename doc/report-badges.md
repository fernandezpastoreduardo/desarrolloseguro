# Sello verificable de informe

El API puede emitir un identificador aleatorio de 256 bits ligado a un informe persistido de `grumphya.com` con perfil `domain-v1`. Solo guarda su SHA-256. Cada sello dura 30 días, puede revocarse y desaparece si la política de retención elimina el informe. No se emite desde datos de muestra ni desde un informe inexistente.

## Emisión

El deploy genera una clave aleatoria local en `/opt/desarrollo-seguro/secrets/development_security_badge_issuer_token` si no existe y la monta solo en el API de Desarrollo Seguro. El archivo es de `root` y modo `0400`; el secreto no se entrega a GitHub, al navegador ni a Grumphya.

Para emitir desde el checkout de Desarrollo Seguro en el VPS, ejecuta el helper como `root` con el UUID de un informe real:

```sh
node scripts/issue-report-badge.mjs <uuid-del-informe-real>
```

El helper valida el UUID, lee la clave solo desde el archivo privado y muestra la respuesta pública de emisión. La API guarda solo SHA-256 del token aleatorio; conserva el token y `verifyUrl` de la salida para el embed. No se puede recuperar después. La emisión se rechaza si el ID no pertenece a `grumphya.com` y al perfil `domain-v1`.

La emisión se autoriza con el secreto que solo conserva el VPS:

```http
POST /api/desarrollo-seguro/v1/badges
Authorization: Bearer <DS_BADGE_ISSUER_TOKEN>
Content-Type: application/json

{"hostname":"grumphya.com","reportId":"<uuid-del-informe-real>"}
```

La respuesta contiene `token`, `verifyUrl` y `expiresAt`. Conserva el token devuelto; no se puede recuperar después.

## Verificación desde la página pública y el sitio

`verifyUrl` abre `/desarrollo-seguro/verificar.html`. El token va en el fragmento `#` de la URL, que no se envía al servidor al abrir la página. El verificador consulta `POST /api/desarrollo-seguro/v1/badges/verify` con `cache: "no-store"`; el token está en el cuerpo de la solicitud y no aparece en el access log. Muestra dominio e ID con `textContent` y enlaza a la vista humana `/app/?report=<reportId>`, el formato que consume el buscador. La página usa `noindex`, `nofollow` y `no-referrer`.

La comprobación es un `POST` con el token en el cuerpo JSON, por lo que no aparece en la URL ni en los access logs. La API comprueba que el informe siga existiendo, que el sello no haya caducado ni se haya revocado y que el origen sea el sitio autorizado.

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
POST /api/desarrollo-seguro/v1/badges/<token>/revocation
Authorization: Bearer <DS_BADGE_ISSUER_TOKEN>
Content-Type: application/json

{"hostname":"grumphya.com","reportId":"<uuid-del-informe-real>"}
```

El endpoint de verificación comprueba `Origin` o los metadatos same-origin del navegador como defensa para incrustación web. No pretende autenticar clientes HTTP que falsifiquen cabeceras fuera del navegador; el sello no es certificado de seguridad ni sustituye la consulta del informe completo.
