# Filosofía de infracciones legales y sanciones

## Estado y alcance

Esta es la filosofía transversal vigente para diseñar el auditor, sus hallazgos y su puntuación. La aplicación adopta la postura del producto definida por su responsable: aplicar la ley vigente con firmeza a partir de evidencia demostrable. No adopta una neutralidad que relativice las infracciones legales acreditadas.

Esta guía gobierna el producto nuevo. En particular, prevalece sobre las restricciones históricas de [`desarrollo-seguro/controls-and-evidence.md`](desarrollo-seguro/controls-and-evidence.md), que declara fuera de alcance inferir cumplimiento legal y deja la interacción con el consentimiento como `unknown`, y de [`desarrollo-seguro/domain-ethics-scoring.md`](desarrollo-seguro/domain-ethics-scoring.md), que limita las puntuaciones a evidencia técnica y dice que no equivalen a cumplimiento legal. Esas reglas describen el auditor de la Beta anterior; no limitan el auditor nuevo. No se cambian informes ni resultados históricos.

La regla antigua de no presentar el informe como certificación general de cumplimiento legal sigue teniendo un alcance distinto: una auditoría concreta no certifica que un sitio cumple todas las leyes. No puede usarse para silenciar una infracción particular cuando las pruebas del auditor acreditan sus elementos legales.

## Regla de clasificación

Cuando pruebas directas, reproducibles y obtenidas por el auditor cubran los elementos de una obligación legal, el resultado se clasifica y comunica como **incumplimiento legal acreditado** o **infracción legal acreditada**, según el precepto aplicable. No se presenta como un mero fallo técnico, indicio, riesgo o posibilidad.

No se usarán fórmulas atenuantes como «susceptible de sanción», «podría ser sancionable» o «posible incumplimiento» cuando la prueba demuestra la conducta y la regla aplicable la tipifica. El informe afirmará el incumplimiento acreditado y dirá qué multa establece la norma, quién es el organismo competente y qué procedimiento corresponde.

La ausencia de una multa ya impuesta no reduce la gravedad del incumplimiento ni convierte en hipotética la consecuencia económica prevista por ley. El informe debe expresar directamente la multa o escala económica aplicable al tipo acreditado; no debe calificarla como una posibilidad remota ni como algo meramente «susceptible». La denuncia no es requisito para que la autoridad actúe: la AEPD puede iniciar actuaciones de oficio y lo hizo en el procedimiento PS-00284-2024 sobre cookies. Una denuncia puede poner los hechos en conocimiento de la autoridad, pero no garantiza por sí sola una sanción. No se afirmará que una resolución concreta ya existe si no se ha observado la resolución correspondiente.

## Registro jurídico por hallazgo

Cada hallazgo debe preservar, sin colapsarlas, las normas que la evidencia acredita como infringidas. Para cada una se documentará:

- la conducta observada y la evidencia reproducible que cubre sus elementos;
- el artículo y la versión vigente de la norma;
- la calificación que establece esa norma;
- la multa o escala económica que establece, con las condiciones que determinan su cuantía;
- el organismo competente y la vía de denuncia o actuación;
- la fecha de verificación de la norma y las fuentes primarias consultadas.

No se copiará una cifra genérica para varias leyes ni se sumarán máximos de distintos procedimientos sin una base legal que permita esa suma. Se mostrarán por separado las consecuencias económicas correspondientes a cada infracción y organismo. La actualización de cuantías, tipos de infracción y competencias forma parte del mantenimiento de la base legal del auditor.

## Auditoría conductual y evidencia

Los controles de consentimiento y seguimiento deben ejecutar el flujo real en un contexto limpio. Como mínimo, la comprobación debe:

1. registrar cookies, almacenamiento y solicitudes de red antes de aceptar o rechazar;
2. accionar el rechazo explícito de cookies no esenciales;
3. volver a comprobar el almacenamiento y las solicitudes inmediatamente después;
4. recargar y comprobar si el rechazo persiste y si el sitio vuelve a crear o transmitir identificadores.

Si se observan cookies analíticas antes de la elección y solicitudes analíticas después del rechazo, cada hecho queda acreditado por separado y se vincula con los preceptos aplicables. La declaración del banner que contradiga el comportamiento observado constituye además evidencia del contenido informativo que recibió el usuario. La falta de prueba sobre otro control, por ejemplo fingerprinting, no rebaja ni elimina estos incumplimientos demostrados.

La captura de una interfaz sirve para evaluar la capa visible, el enlace a la política y el trato visual de los controles. El estado de cookies y la actividad analítica se verifican con el almacenamiento y las solicitudes reales del navegador; no se sustituyen por inferencias basadas solo en el texto del aviso o en una lista estática de nombres.

## Acumulación y puntuación

El auditor conserva cada infracción legal acreditada, incluso cuando una conducta activa obligaciones de varias leyes o competencias de distintos organismos. La evaluación debe reflejar la gravedad legal y la acumulación: no debe normalizar, promediar hasta ocultar ni tratar como anecdótica una conducta que la ley sanciona. Los hallazgos confirmados deben afectar de forma material al resultado.

La fórmula numérica, pesos, topes y presentación de consecuencias se definirán en la toma de requisitos del modelo de evaluación nuevo. Esa definición no puede rebajar la regla anterior ni tratar como incertidumbre los incumplimientos ya acreditados.

## Criterios de aceptación para futuras capacidades

- La interfaz y los informes distinguen «incumplimiento legal acreditado» de un control técnico sin evaluar.
- Para cada infracción acreditada se presentan evidencia, artículos, sanciones económicas previstas, organismo competente y fuente vigente.
- El flujo de rechazo comprueba tanto el estado local como las transmisiones posteriores, incluida la recarga.
- Infracciones concurrentes no desaparecen bajo una única etiqueta genérica ni se omite una competencia legal acreditada.
- La ausencia de una denuncia o de una resolución previa no se usa para suavizar la descripción ni la puntuación del incumplimiento.
- Una prueba no ejecutada o técnicamente imposible se marca como no evaluada solo para ese control; no contamina ni rebaja otros incumplimientos demostrados.

## Fuentes primarias para el mapeo

La base legal concreta debe consultar la redacción consolidada vigente y los criterios publicados por el organismo competente en la fecha de cada revisión. Como referencias iniciales para el ejemplo de cookies:

- [Ley 34/2002 (LSSI), texto consolidado](https://www.boe.es/buscar/act.php?id=BOE-A-2002-13758): artículos 22, 38, 39 y 43.
- [Reglamento (UE) 2016/679 (RGPD), texto oficial](https://www.boe.es/buscar/doc.php?id=DOUE-L-2016-80807): artículos 5, 6, 7 y 83.
- [Ley Orgánica 3/2018 (LOPDGDD), texto consolidado](https://www.boe.es/buscar/act.php?id=BOE-A-2018-16673): artículos 72 a 76.
- [Guía de cookies de la AEPD](https://www.aepd.es/guias/guia-cookies.pdf).

La presencia de varios preceptos o autoridades se registra de manera explícita. La atribución de competencia y la multa prevista se verifican artículo por artículo; la guía no sustituye esas cuantías por un rango genérico común a varias leyes.
