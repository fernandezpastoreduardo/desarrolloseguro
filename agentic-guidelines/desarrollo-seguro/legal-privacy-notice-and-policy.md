# Política de privacidad y aviso inicial

## Propósito y alcance

DesarrolloSeguro.org publica una política de privacidad identificable y accesible
desde una página dedicada, además de un aviso modal de primera visita en la web
pública y en `/app/`. La política describe el tratamiento observado en el
despliegue actual; no promete prácticas o garantías que no estén configuradas.

## Identidad y contacto

- Responsable: Eduardo Fernández Pastor.
- Domicilio: Avenida de América 46, 4.º A, 50007 Zaragoza, España.
- Contacto: `contacto@desarrolloseguro.org`.
- No se ha designado delegado de protección de datos.

## Tratamientos que debe explicar la política

1. **Visita y uso del portal:** solicitudes HTTP(S) al servidor y registros de
   acceso. La configuración desplegada envía el access log de Nginx a stdout y
   Docker lo guarda con `json-file`, sin límites de tamaño ni rotación. El
   formato Nginx predeterminado puede incluir la dirección del proxy Caddy que
   conecta con Nginx, fecha, método y URI completa (incluida query), estado,
   referente y user-agent. Nginx no está configurado para sustituir esa
   dirección por la IP real del visitante. La política debe indicar que no
   existe un plazo automático ni rotación configurada para esos logs;
   permanecen hasta su borrado manual o la sustitución/eliminación del
   contenedor. No atribuirles una retención de una hora.
2. **Solicitud de auditoría:** el visitante entrega una URL HTTPS completa con
   ruta y query. La ruta y query quedan ligadas al informe público; el destino
   recibe solicitudes desde el VPS y sus recursos autorizados pueden ser
   contactados durante la auditoría. La query puede contener datos personales o
   secretos; la interfaz y la política deben advertir que no se incluyan.
3. **Informes:** el informe queda vigente para consulta/caché durante 60 minutos.
   Eso es caducidad de vigencia, no borrado físico. En producción, la purga
   general puede conservar los datos del informe hasta 90 días desde su
   finalización. La política debe distinguir ambos plazos. El perfil actual
   `domain-v5` no entra en la purga de inactividad de 30 días, que cubre perfiles
   anteriores.
4. **Informes públicos:** los informes pueden consultarse por su identificador
   público mientras se conservan. La caducidad a 60 minutos solo marca que el
   informe ya no está vigente para la consulta actual; no lo vuelve privado ni
   lo borra.
5. **Transparencia de servicios:** desarrolloseguro.org se somete al mismo
   informe público y auditoría que los dominios de clientes. Además, se publica
   el inventario interno versionado de los proveedores que alojan o procesan el
   servicio.
6. **Alojamiento y transferencias:** el registro de procesadores declara IONOS
   VPS para web, API y base de datos. El responsable confirma que el servicio
   configurado no transfiere datos de usuarios alojados fuera del EEE. La
   inspección de producción del 27-11-2026 confirma que API, worker y base de
   datos solo están conectados a redes Docker internas; el único contenedor
   conectado a la red pública de egress es `processor-auditor`, que hace las
   solicitudes propias de auditoría.
   Las auditorías sí pueden dirigir solicitudes al dominio introducido y a
   recursos externos, potencialmente fuera del EEE; son conexiones de la
   auditoría solicitada, separadas del alojamiento y del tratamiento de datos
   alojados.
7. **Aviso de primera visita:** no se usan cookies de analítica o publicidad ni
   se envían datos de navegación a servicios de analítica. El aviso se recuerda
   una sola vez por navegador mediante un único booleano en `localStorage` tras
   pulsar «Entendido». La política identifica esa clave y su finalidad; no la
   denomina cookie. No se introduce ningún otro almacenamiento de preferencias
   para este aviso.

## Comportamiento del aviso

- Se presenta al primer acceso a las páginas públicas y a `/app/` cuando no
  existe el marcador de reconocimiento.
- Contiene el logotipo oficial, el texto exacto «No usamos cookies que envíen o
  vendan información a nadie en esta web.», enlace directo a la política y el
  botón «Entendido».
- «Entendido» cierra el diálogo y persiste únicamente el marcador de
  reconocimiento en `localStorage`; ninguna elección de cookies ni perfil se
  guarda.
- El enlace a la política permanece visible y operativo dentro del diálogo.
- Implementación accesible, teclado y móvil; no bloquea ni oculta contenido de
  fondo más allá del diálogo modal.
- CSS solo en SCSS; no se añade dependencia.

## Ruta, navegación y accesibilidad

- Nueva ruta pública: `/desarrollo-seguro/politica-de-privacidad.html`.
- La política es distinta de «Privacidad y alcance» (explicación metodológica).
- La ruta aparece en el pie de las páginas públicas y en el aviso inicial.
- El documento incluye identidad/contacto, finalidades, bases jurídicas
  aplicables, categorías de datos, destinatarios, transferencias, conservación,
  derechos y contacto de la AEPD, ausencia de DPD y referencia a la evaluación
  automatizada del sitio (no de idoneidad personal).

## Criterios de aceptación

- El texto identifica al responsable con los datos anteriores y no afirma que
  informes o logs desaparezcan a los 60 minutos.
- Se declara la vigencia/caché de informe de 60 minutos y que deja de estar
  vigente sin desaparecer del enlace público; la base de producción lo purga
  después de 90 días, en un ciclo diario posterior al umbral. Los logs se
  describen con su estado real de retención sin fijar plazo inexistente.
- El texto diferencia los procesadores declarados del destino de una auditoría
  y no afirma que la web nunca contacte servidores fuera del EEE.
- El responsable ha elegido interés legítimo (art. 6.1.f RGPD) para el
  tratamiento de auditorías e informes públicos de dominios ajenos y para
  seguridad operativa. La política describe expresamente esos intereses.
- El portal y las páginas públicas exponen el aviso y el enlace a política en la
  primera visita; «Entendido» lo cierra y evita que reaparezca en ese navegador.
- El aviso no instala cookies y solo guarda una clave local de reconocimiento.
- La ruta de política se sirve desde el artefacto de producción y enlaza desde
  footer y aviso.
- Se verifica build, pruebas de páginas públicas y flujo del diálogo; se
  actualiza `doc/` y se elimina de `wanna-bes.md` cualquier idea implementada.

## Fuentes normativas oficiales enlazadas en la política

- Reglamento (UE) 2016/679 (RGPD), especialmente artículos 5, 6, 12–15, 17–22,
  28, 32 y 44.
- Ley Orgánica 3/2018, de Protección de Datos Personales y garantía de los
  derechos digitales.
- Ley 34/2002, de servicios de la sociedad de la información y de comercio
  electrónico, especialmente artículos 10 y 22.2.
- Guía de cookies de la AEPD, para describir de forma precisa el almacenamiento
  local del aviso y no confundirlo con una cookie.
