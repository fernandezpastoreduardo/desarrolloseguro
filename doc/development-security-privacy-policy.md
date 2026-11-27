# Política de privacidad y aviso de primera visita

La política pública está en `/desarrollo-seguro/politica-de-privacidad.html`.
La página «Privacidad y alcance» sigue explicando la metodología y enlaza a la
política legal.

La política identifica a Eduardo Fernández Pastor y publica su domicilio y el
correo `contacto@desarrolloseguro.org`. Declara que no hay DPD designado, que la
base para auditorías/informes y seguridad operativa es el interés legítimo del
responsable (art. 6.1.f RGPD), y que el sitio de Desarrollo Seguro recibe el
mismo informe público de transparencia y la misma auditoría que los dominios de
clientes.

## Datos operativos comprobados

- La URL auditada incluye ruta y query; el informe público conserva ese alcance
  y puede consultarse por su identificador. No introduzcas consultas con
  credenciales, tokens o datos privados.
- El informe queda vigente 60 minutos. Vencer no lo elimina ni lo hace privado;
  la purga de producción se ejecuta a diario al superar 90 días desde el
  cierre, así que los datos pueden conservarse algo más de 90 días.
- Nginx envía logs de acceso a stdout y errores warning o superiores a stderr.
  El formato de acceso puede incluir URI con query, fecha, método, estado,
  referente y user-agent. El campo de dirección remota de Nginx corresponde al
  proxy Caddy; Nginx no sustituye ese valor por la IP real del visitante.
- En el VPS, Docker usa el controlador `json-file` sin opciones de tamaño o
  rotación. Por eso no existe borrado automático configurado para los logs; la
  política pública lo indica en lugar de atribuirles un plazo ficticio.
- IONOS presta el VPS para la web, API y base de datos y trata allí los datos
  alojados para suministrar la infraestructura. El responsable confirma que la
  configuración actual no transfiere esos datos fuera del EEE.
- La inspección de solo lectura del VPS el 27 de noviembre de 2026 confirmó que
  las redes backend, edge y de entrada de Desarrollo Seguro son internas; API,
  worker y base de datos no tienen salida directa a Internet. El auditor
  processor es el único contenedor conectado a la red de egress pública, para
  consultar las fuentes y destinos que forman parte de los análisis.
- Una auditoría sí puede enviar solicitudes al sitio introducido y a recursos
  externos, incluso fuera del EEE; estos reciben la IP pública del VPS y la URL
  consultada. Esto es tráfico explícito de auditoría, separado de las
  transferencias de los datos alojados a proveedores.

## Aviso inicial

El aviso aparece en las páginas públicas y en `/app/` mientras no exista el
marcador `ds-first-entry-notice-dismissed` en `localStorage`. Muestra el logo,
el texto «No usamos cookies que envíen o vendan información a nadie en esta
web.», el enlace a la política y el botón «Entendido». Solo este botón guarda
el marcador; no se instalan cookies ni se almacena una elección de cookies.
El marcador es local al navegador y puede borrarse desde su configuración.

La política vincula las fuentes oficiales del RGPD, LOPDGDD, LSSI y guía de
cookies de AEPD. No se usa analítica, publicidad ni recursos remotos incrustados
en la web pública.
