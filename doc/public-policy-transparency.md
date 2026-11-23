# Información pública sobre servicios externos

Los informes de `domain-ethics-v5` incorporan una comprobación de lo que el
propio sitio explica públicamente sobre los servicios que utiliza. El análisis
busca enlaces a privacidad, cookies, condiciones e información legal en la
portada y consulta solo esos destinos mediante el lector de red aislado.

La comprobación identifica nombres de proveedores y finalidades cuando ambos
aparecen expresamente en el texto de la política. Conserva el resultado, el
número de páginas revisadas, las menciones de proveedores y las categorías
reconocidas; no guarda las páginas, sus textos ni las direcciones externas.
El informe público muestra cuántos proveedores se reconocieron y cuántos no
tenían una finalidad explicada en el mismo fragmento de la política.

## Qué significa el resultado

- **Información encontrada:** el sitio publica información reconocible sobre
  servicios externos y sus finalidades. Esto acredita que se encontró una
  declaración; no demuestra que sea completa, verdadera o que coincida con la
  actividad interna.
- **Información insuficiente:** el análisis pudo leer la portada y los enlaces
  pertinentes, pero no encontró una política o no pudo identificar en ella
  proveedores y finalidades. Este resultado afecta a la transparencia pública.
- **Acceso denegado o página no disponible:** el sitio bloqueó el acceso o el
  enlace publicado no pudo abrirse. Es un hallazgo de transparencia, no una
  conclusión legal automática.
- **En revisión:** el lector tuvo un error técnico propio, agotó un límite o no
  pudo procesar el formato. No se penaliza esa comprobación incompleta. Si el
  lector conoce la causa, el informe la resume en lenguaje sencillo. Solo se
  conserva un código técnico de una lista cerrada; nunca se publican errores
  crudos, direcciones, cabeceras, páginas ni valores de cookies.

Los nombres de proveedores y finalidades salen de un catálogo local revisado.
El catálogo puede no reconocer todas las marcas o expresiones. En ese caso,
el sistema deja el punto en revisión mientras se corrige el catálogo o el
lector; no inventa una finalidad.

## Clientes y otros dominios

Para los dominios cliente con inventario autenticado, el criterio ético de 10
puntos se calcula con el inventario privado firmado. La revisión de políticas
públicas se conserva como información complementaria y no reemplaza el
inventario. Para los demás dominios, el criterio se calcula con la evidencia
pública descrita arriba. Los informes históricos conservan su versión de
política y no se recalculan.

La verificación es de solo lectura. Las solicitudes de política no incluyen
cookies, credenciales ni `Referer`, solo aceptan HTTPS en el puerto 443 y no
siguen redirecciones a otro host. El lector limita el tiempo, las solicitudes,
el volumen de datos y la cantidad de páginas. Al agotar un límite, deja el
resultado en revisión.
