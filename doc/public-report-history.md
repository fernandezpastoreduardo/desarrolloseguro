# Historial público de informes

La etapa B añade `GET /api/desarrollo-seguro/v1/domains/:hostname/history`.
La respuesta contiene como máximo doce entradas ordenadas por `completedAt`
descendente. Cada entrada incluye el identificador UUID del informe, el perfil,
la fecha, la caducidad, el veredicto, la puntuación ética provisional y el
estado de certificación beta.

El endpoint solo devuelve informes de dominios no excluidos y de los perfiles
externos `domain-v1`, `domain-v2`, `domain-v3` o `domain-v4`. No expone evidencias, HTML,
cabeceras, cookies, direcciones IP, métricas internas ni diagnósticos. Mantiene
`Cache-Control: no-store` porque el historial puede cambiar al completarse una
auditoría.

Los UUID no son enumerables y cada enlace abre la ficha pública inmutable del
informe correspondiente. La interfaz muestra que las puntuaciones solo son
comparables cuando comparten el mismo perfil de controles; no mezcla perfiles
históricos de forma silenciosa.

La conservación pública ya aplica una ventana de inactividad de 30 días para
informes `on_demand` sin certificación activa. El scheduler diario ejecuta una
función `SECURITY DEFINER` con el rol aislado `ds_retention`; elimina únicamente
los informes públicos y sus trabajos terminados, conserva los informes
certificados y los dominios monitorizados, y rechaza cortes más recientes de
la ventana. La migración beta 025 reactiva la caché de una hora y el intervalo
de 24 horas entre admisiones cuando la caché ha caducado. La migración 027 permite
reintentar tras un fallo terminal, porque la ventana solo se aplica a trabajos
completados. La coordinación de
auditorías/progreso sigue usando el estado consultable. Un canal SSE puede
añadirse como mejora posterior, pero no es un criterio de aceptación de B ni
una dependencia de C.
