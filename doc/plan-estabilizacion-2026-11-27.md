# Propuesta de estabilización del proyecto

27 de noviembre de 2026. Aprobado para P0 y P1. P0 está completada y P1 continúa.
No se ha cambiado producto, eliminado código ni realizado un despliegue.

La revisión encontró causas verificables para varios defectos: el reintento puede
salir sin enviar una solicitud; fallos tardíos pueden borrar evidencia de cookies;
los perfiles incompletos pierden métricas válidas y su diagnóstico se reemplaza
durante la ingesta. También confirmó que la integración de clientes depende de
nombres concretos en varias capas y que los E2E actuales sustituyen la API.

Por eso un workflow verde no acredita todavía el recorrido de un usuario que
solicita una auditoría pública nueva. El último despliegue pasó sus comprobaciones,
pero estas no ejercían todos los comportamientos que el producto promete.

## Orden propuesto

| Paquete | Resultado que debe entregar |
| --- | --- |
| P0 · Baseline | Completada en `2e15559`: Sonar Quality Gate aprobado, hooks y cobertura documentados; 191 tests omitidos y cobertura de Sonar limitada al código de las apps |
| P1 · Laboratorio real | En curso: retry muerto reproducido como regresión esperada con hostname sintético; falta el recorrido de artefactos reales hasta el informe mostrado |
| P2 · Recuperación | Reintento funcional, resultados por fase, métricas parciales conservadas y diagnóstico de extremo a extremo |
| P3 · Contratos | Esquemas canónicos y políticas fuera de React; validación de escritura/lectura y compatibilidad |
| P4 · Módulos y limpieza | Categorías independientes, repositorios pequeños y retirada demostrada de código/tests sustituidos |
| P5 · Clientes | Alta por identidad y capacidades; DesarrolloSeguro auditado con el mismo contrato que otros clientes |
| P6 · Sonar y deuda | Hallazgos corregidos y hotspots revisados; sin exclusiones para fabricar un gate verde |
| P7 · Entrega | Artefacto probado igual al promovido, comprobación previa al tráfico y rollback verificado |

Sonar y la preparación de la entrega segura empiezan en P0 y acompañan los demás
paquetes. El primer despliegue de recuperación requiere laboratorio y correcciones
verificados, más comprobación previa y procedimiento de recuperación. No hace falta
esperar a terminar todo el refactor para recuperar el servicio.

Se propone pausar nuevas features mientras se estabiliza el recorrido. Cada paquete
se divide en tareas pequeñas; este documento no autoriza una reescritura de una vez.
Los cambios de criterios, notas o significado del informe necesitan aprobación
expresa previa. Se mantiene la filosofía de infracciones legales demostradas.

## Qué cambia en las pruebas

Los tests se organizan por comportamiento y riesgo, no por nombres de dominios ni
por número de aserciones. El laboratorio genera hostnames diferentes y comprueba
una URL nueva, reintento, cookies en las tres fases, páginas sin cookies o con
cookies técnicas, terceros lentos, límites, redirecciones y errores de adquisición
y persistencia. La UI debe mostrar el resultado y recuperarse sin recarga.

Las unitarias cubren reglas puras; integración cubre contratos, permisos y SQL;
el navegador recorre API/worker/runtime reales sobre artefactos construidos.
Los sitios públicos pueden servir de contraste adicional, sin convertirse en
excepciones de código ni en la única puerta de entrega.

Un archivo sin cobertura no se elimina por ese motivo. Primero se comprueban sus
consumidores y su función. Un test no conectado se revisa antes de borrarlo; pueden
faltar precisamente las pruebas que deberían estar ejecutándose.

El plan técnico y los criterios de aceptación de cada paquete están en
[`stabilization-and-modularization-plan.md`](../agentic-guidelines/desarrollo-seguro/stabilization-and-modularization-plan.md).

En la reproducción de P1, el envío POST se mantuvo en una solicitud antes y después
del click en «Volver a solicitar análisis»; el botón mostró el estilo predeterminado
del navegador. La suite de cobertura de P0 pasó 1.422 pruebas y omitió 191, incluidas
190 de persistencia. La integración completa aún no se ha verificado.

El navegador también mostró que el E2E anterior pasa sin pulsar el retry. Se añadió
una regresión que ahora pulsa y verifica el segundo POST y la recuperación sin
recargar; pasó con el fix. El laboratorio integral se diseñó para usar adaptadores
exclusivos de prueba y una red interna desechable, preservando la política SSRF de
producción; todavía no está construido.

Las correcciones adelantadas de P2 hacen que el retry reenvíe la solicitud
autorizada de la misma URL, que un fallo tardío de Privacidad conserve inventarios
previos y que Rendimiento retenga métricas parciales y sus diagnósticos. No alteran
umbrales ni puntuaciones. Pasaron `ci:verify quality`, los 6 E2E, Lighthouse (100 en
las tres categorías bloqueantes en móvil y escritorio), PostgreSQL (195 pruebas de
persistencia y 1 de worker) y el Quality Gate local de Sonar. Falta repetir Sonar tras
commit por advertencias SCM, y falta el laboratorio integral antes de considerar
seguro el deploy.
