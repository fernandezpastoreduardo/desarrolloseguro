# Refinamiento de la ficha pública

La comparación de servicios externos y su resultado público se rigen ahora
por [`public-service-comparison.md`](./public-service-comparison.md). Ese
contrato extiende los requisitos de interfaz de este documento y prevalece
cuando el texto histórico todavía describe contadores de crawler o separa la
nota pública del inventario privado.

## Propósito

Hacer que la ficha de informes se entienda y se recorra con facilidad para una persona sin formación tecnológica, sin rebajar el rigor de las comprobaciones ni presentar como hechos cosas que no se han observado.

## Alcance acordado

- Revisar en lenguaje llano los textos de puntuación, categorías y resultados que aparecen en la ficha.
- Explicar una sola vez cómo se obtiene la nota: qué dimensiones combina, cómo trata los aspectos no observados y qué límites tiene. No repetir la proporción en la cabecera ni en varios resúmenes.
- Mostrar actividad visible y accesible durante el registro, la cola y la ejecución de un análisis. El texto debe explicar que está trabajando y puede tardar; no se inventará un porcentaje de progreso.
- En la auditoría privada de Grumphya, distinguir una comprobación activa (spinner con anuncio accesible) de un resultado antiguo, caducado, incompleto o con error (mensaje estático «En revisión»). No atribuir un fallo de infraestructura al dominio.
- Rediseñar la presentación de los 14 criterios con grupos visuales, jerarquía, espacio y estados comprensibles. Mantener los 14 criterios, su sentido y el rigor de las consecuencias; no mostrar puntuación privada, pesos ni métricas.
- Explicar junto al bloque que Grumphya ha decidido compartir aspectos internos de su aplicación, y que esa transparencia permite publicar información adicional. Aclarar que el bloque es independiente de las notas Ética y Privacidad y no constituye una garantía absoluta.
- Mantener SCSS, accesibilidad de teclado y lector de pantalla, contraste, diseño adaptable y respeto de `prefers-reduced-motion`.
- La interfaz de informe no añade recursos externos, cookies ni transmisiones de datos. Las visitas del auditor a políticas públicas están limitadas a la comprobación descrita abajo y no forman parte de la carga de la ficha para el visitante.

## Regla de evidencia pública

- En informes de clientes que hayan autorizado la auditoría privada, se usa la evidencia interna firmada disponible, además de la evidencia pública.
- En dominios externos se evalúa la información que el titular debe poder publicar y que el auditor pueda comprobar legalmente. La ausencia de esa información exigible es un fallo de transparencia y penaliza; no se presenta como «Sin conclusión».
- Si la documentación declara una práctica, se trata como la declaración pública del titular. No se afirma que sea falsa salvo que evidencia observada la contradiga.
- «En revisión» se reserva para errores técnicos atribuibles al auditor o para una interrupción que impida completar la comprobación. Una respuesta correcta del sitio que no permita localizar información pública exigible no es un error del auditor.
- No se infieren contratos o prácticas privadas a partir de señales indirectas. Se informa de lo declarado y de lo observado por separado.
- El auditor puede seguir enlaces públicos desde el dominio auditado hasta páginas de privacidad y condiciones de terceros dentro del sandbox de egress. Para el crawler documental de `domain-v4` se aplican 120 segundos, 64 solicitudes HTTP(S), 4 MiB agregados, 30 documentos y cuatro descargas simultáneas; el límite que se alcance primero deja el resto en revisión. No envía formularios ni credenciales. Los límites de la auditoría web de Solistos son independientes.
- Un bloqueo explícito del auditor por parte del sitio que aloja la documentación se registra como fallo de transparencia; un fallo de red ajeno al sitio o del propio auditor queda «En revisión».
- El resultado enseña en lenguaje llano qué se observó, qué declara el titular y qué consecuencia puede tener para las personas usuarias. No se presenta como un escáner técnico genérico.

### Comprobación de declaraciones sobre servicios externos

- Para `grumphya.com` y `desarrolloseguro.org`, usar la evidencia interna autenticada, firmada y vigente ya acordada para sus integraciones de backend. Presentar aparte la política del titular y las conexiones que se observan desde fuera.
- Para otros dominios, descubrir enlaces HTTPS de privacidad, cookies, condiciones o información legal desde la portada y desde la política principal. Solo seguir destinos públicos por puerto 443 y dentro del sandbox de egress con DNS/IP validados; no usar formularios, credenciales ni JavaScript del dominio para esta comprobación.
- Usar el catálogo local revisado de proveedores y términos como indicio de búsqueda, no como dictamen legal. Guardar la versión de catálogo y la URL pública saneada que sustenta cada señal; nunca guardar cuerpos, query, fragmentos, IP ni datos personales.
- Comparar servicios externos observados con lo que el titular publica sobre destinatarios o categorías de destinatarios, finalidades y enlace a información del proveedor cuando esté disponible. Mostrar por separado “Lo que declara el sitio” y “Lo que observamos desde fuera”; una declaración no prueba la práctica del proveedor.
- Si falta la política o información pública exigible, un proveedor observado no figura en lo publicado, o el sitio de la política deniega explícitamente el acceso al auditor, registrar `fail` de transparencia. No describirlo como mala práctica contractual ni como falsedad no demostrada.
- Si un error de egress, DNS, TLS, respuesta incompleta o límite global del auditor impide la comprobación sin una denegación explícita del sitio, registrar `unknown`/“En revisión”, sin atribuirlo al dominio. Un HTTP 403/429, CAPTCHA u otra denegación explícita del sitio sí es `fail` de transparencia según la decisión del usuario.
- Presupuesto agregado del crawler de políticas: 120 s, 64 solicitudes HTTP(S), 4 MiB recibidos y hasta 30 documentos; el primer límite alcanzado deja la parte restante `unknown`, nunca penalizada por el límite propio. Los límites aprobados para la auditoría de Solistos son otra fase y no se amplían por este cambio.

## Comportamiento y límites

- Una animación de espera solo indica actividad. No implica que las comprobaciones hayan terminado ni que el dominio tenga un resultado favorable.
- Si la solicitud está en cola, se informa que espera turno; cuando el worker la ejecuta, el mensaje cambia a comprobación en curso.
- Si el sondeo de estado se interrumpe o no aparece un trabajo activo, la interfaz deja el spinner y explica que no pudo confirmar la revisión.
- Los 14 criterios no mostrarán catorce spinners. La actividad de la auditoría se indica una vez en el encabezado del bloque; las filas pendientes dicen que esperan resultado vigente.
- La presentación explica que los resultados describen señales y páginas observadas en la fecha indicada; no afirma cobertura universal ni ausencia total de riesgos.
- La nota de dominios externos debe puntuar la falta de información pública exigible; un bloqueo explícito al auditor es fallo de transparencia, mientras que una caída o error del auditor queda en revisión. La implementación debe guardar qué documento público se encontró, qué señales observadas sustentaron la comparación y qué quedó fuera del alcance.

## Criterios de aceptación

1. Una persona no técnica puede entender, sin conocer siglas internas, qué representa cada categoría y cómo leer la nota.
2. La fórmula y el tratamiento de aspectos no evaluados se explican una sola vez, en lenguaje llano; la cabecera no repite «50/50».
3. El envío inicial, la cola y la ejecución muestran actividad visible, texto claro y anuncios accesibles; no se inventa un porcentaje.
4. La ficha distingue una auditoría activa de una auditoría sin resultado vigente; solo el estado activo anima el spinner.
5. El bloque de los 14 criterios comunica la transparencia elegida por Grumphya y qué límites conserva.
6. Los 14 aspectos se presentan con una jerarquía visual actual, grupos semánticos, estados legibles sin depender solo del color y adaptación a móvil y escritorio.
7. No se exponen datos técnicos privados ni recomendaciones dirigidas a desarrolladores; la consulta de políticas externas respeta los límites de red autorizados.
8. Los textos y resultados separan las declaraciones públicas de los hechos observados; no declaran que se haya verificado una práctica contractual invisible.
9. La falta de información pública exigible o la denegación explícita penaliza en dominios externos; los errores del auditor o el presupuesto agotado quedan en revisión.
10. Las pruebas cubren contenido llano, jerarquía/agrupación, estados de espera activos y no activos, anuncios accesibles, regla de evidencia y ausencia de recomendaciones técnicas.

## Verificación y publicación

- Ejecutar verificaciones locales y los gates de CI, incluyendo integración PostgreSQL, navegador, seguridad y calidad.
- Lighthouse mantiene los umbrales acordados; la excepción temporal de SEO autorizada el 23 de noviembre de 2026 solo aplica mientras `/app/` conserve `noindex`.
- Tras gates verdes, integrar en `main`, desplegar Desarrollo Seguro y comprobar los smoke checks de producción.
- Documentar el comportamiento terminado en `doc/` y retirar de `wanna-bes.md` cualquier idea que corresponda a esta mejora y haya quedado implementada.
