# Resumen público de la auditoría interna de Grumphya

## Propósito

La ficha pública de `grumphya.com` debe explicar el alcance del trabajo técnico privado de Desarrollo Seguro, que actualmente no aparece en la ficha. El resumen es independiente de las puntuaciones Ética y Privacidad, de la certificación y del sello público.

## Alcance

- Mostrar exclusivamente en la ficha pública de `grumphya.com`.
- Enumerar los 14 criterios de la auditoría interna vigente, con orden y nombres para público general.
- Para cada criterio mostrar solamente el estado público y una explicación sencilla de qué significa para las personas usuarias, incluyendo el posible impacto cuando se confirma una penalización.
- No mostrar la puntuación interna, pesos, métricas, valores observados, códigos de motivo, rutas, nombres de paquetes, configuración, secretos, trazas ni detalles que faciliten explotar un hallazgo.
- Sustituir instrucciones de remediación para desarrolladores por explicaciones de significado e impacto. Mantener la ficha dirigida al público general.
- El bloque no afecta las notas Ética/Privacidad, la nota global, la elegibilidad, el estado de certificación ni el sello.

## Actualización y estados

- La auditoría privada de producción de Grumphya se ejecuta aproximadamente con cada ciclo horario de informes.
- La auditoría permanece en el servicio aislado, sin acceso a PostgreSQL ni a servicios ajenos a su allowlist. La integración solo transporta una proyección pública acotada y validada al almacenamiento del informe.
- Cuando se está creando o renovando la evidencia, o la renovación falla, el bloque presenta el estado general **En revisión**. No presenta como actuales los resultados de una auditoría anterior.
- Al terminar correctamente, cada criterio presenta uno de estos estados:
  - `pass`: **Correcto**.
  - `fail`: **Atención**, acompañado de una explicación llana del posible impacto, sin detalles técnicos explotables.
  - `unknown`: **En revisión**, sin atribuir el resultado a Grumphya.
  - `not_applicable`: **No aplica**.
- Si la evidencia firmada no está vigente, no se muestra como actual; el bloque pasa a **En revisión** hasta la siguiente ejecución válida.
- El bloque identifica la fecha de la auditoría cuyos estados muestra. Mientras está en revisión puede indicar que se está actualizando, pero no mostrar una fecha vieja como evidencia vigente.

## Catálogo editorial de 14 criterios

Cada fila usa el identificador canónico interno y un nombre/explicación pública sin exponer el identificador técnico:

1. `infrastructure.tls` — Conexión protegida: si falla, la información transmitida podría quedar expuesta o ser alterada durante el envío.
2. `infrastructure.headers` — Protecciones del navegador: si falla, el navegador podría no contar con barreras que ayudan a frenar ataques comunes.
3. `infrastructure.network` — Acceso a servicios: si falla, podrían quedar accesibles servicios que deberían permanecer restringidos.
4. `application.dependencies` — Componentes de software: si falla, componentes desactualizados o con riesgos conocidos podrían afectar a la aplicación.
5. `application.secrets` — Protección de credenciales: si falla, credenciales de servicio podrían quedar expuestas y permitir accesos no autorizados.
6. `authentication.authorization` — Acceso a cuentas y funciones: si falla, una persona podría acceder a información o funciones que no le corresponden.
7. `quality.e2e` — Funcionamiento de recorridos principales: si falla, algunas tareas podrían no completarse correctamente.
8. `quality.accessibility` — Accesibilidad: si falla, algunas personas podrían encontrar barreras para utilizar la aplicación.
9. `performance.page_load` — Rapidez de carga y respuesta: si falla, la aplicación podría tardar en mostrar contenido o responder.
10. `privacy.cookies` — Almacenamiento en el navegador: si falla, podrían guardarse datos de seguimiento o preferencias de forma no esperada.
11. `privacy.third_parties` — Conexiones con otros servicios: si falla, información podría compartirse con servicios externos de forma no esperada.
12. `privacy.consent` — Elección de privacidad: si falla, las preferencias de privacidad podrían no respetarse correctamente.
13. `ethics.transparency` — Información clara sobre servicios externos: si falla, las personas podrían no saber qué servicios participan o para qué se usan.
14. `ai.disclosure` — Información sobre uso de inteligencia artificial: si falla, podría faltar información sobre la participación de sistemas de IA.

El texto expresa el posible impacto y no afirma que haya ocurrido un daño. Para resultados `pass`, se formula en positivo y no se muestra la consecuencia de fallo.

## Seguridad y privacidad

- La API pública recibe una proyección allowlisted distinta del informe privado completo.
- La proyección incluye solo identificador de criterio, estado agregado y fecha de observación/auditoría. No incluye `auditRef`, `reasonCode`, `value`, `unit`, `limit`, envolturas firmadas, entradas originales ni atestaciones.
- Los estados críticos se describen de manera general y no revelan qué ruta, servicio, versión, dependencia, credencial o barrera concreta originó el resultado.
- El lector privado mantiene sus scopes y rutas autorizadas; el endpoint público de informes no puede iniciar auditorías ni aceptar parámetros para hacerlo.
- El informe histórico ya emitido conserva su contenido inmutable. Los informes nuevos contienen el resumen público.

## Criterios de aceptación

1. Solo los informes/fichas canónicos de `grumphya.com` pueden incluir el bloque.
2. El bloque presenta las 14 filas cuando la auditoría es válida y completa, con estado comprensible y fecha de auditoría.
3. Ningún valor técnico, nota interna, ponderación, evidencia privada o secreto llega al DTO público o a la respuesta de API.
4. Una auditoría en ejecución, fallida, incompleta, inválida o vencida se presenta como **En revisión**; no se reciclan resultados anteriores como si fueran actuales.
5. Un fallo de criterio se expresa como posible impacto comprensible, sin consejos a desarrolladores y sin afirmaciones de daño confirmado.
6. La auditoría privada se ejecuta aproximadamente con cada ciclo horario ya existente y sigue aislada; un fallo de auditoría no cambia el informe público externo ni su puntuación.
7. Una respuesta pública histórica mantiene su esquema y significado previos; solo los informes creados tras la migración incluyen el bloque.
8. El diseño es accesible en móvil y escritorio y no requiere JavaScript de terceros ni añade cookies o transmisión externa.
9. La ficha deja claro que el bloque es una comprobación técnica de Grumphya y no equivale a una garantía absoluta de seguridad o ausencia de riesgos.
