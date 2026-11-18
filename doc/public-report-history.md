# Historial público de informes

La etapa B añade `GET /api/desarrollo-seguro/v1/domains/:hostname/history`.
La respuesta contiene como máximo doce entradas ordenadas por `completedAt`
descendente. Cada entrada incluye el identificador UUID del informe, el perfil,
la fecha, la caducidad, el veredicto, la puntuación ética provisional y el
estado de certificación beta.

El endpoint solo devuelve informes de dominios no excluidos y de los perfiles
externos `domain-v1`, `domain-v2` o `domain-v3`. No expone evidencias, HTML,
cabeceras, cookies, direcciones IP, métricas internas ni diagnósticos. Mantiene
`Cache-Control: no-store` porque el historial puede cambiar al completarse una
auditoría.

Los UUID no son enumerables y cada enlace abre la ficha pública inmutable del
informe correspondiente. La interfaz muestra que las puntuaciones solo son
comparables cuando comparten el mismo perfil de controles; no mezcla perfiles
históricos de forma silenciosa.

Este incremento no activa todavía la caché de una hora ni la eliminación por
inactividad de 30 días descritas para la etapa B completa. Esas políticas se
incorporarán junto con la coordinación de auditorías públicas y tendrán sus
propios tests de persistencia y operación.
