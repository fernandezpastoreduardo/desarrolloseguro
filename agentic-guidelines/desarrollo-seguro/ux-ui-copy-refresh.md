# Revisión de UX, identidad visual y copy público

## Estado y relación con otras guías

Esta especificación define una revisión de UX, UI e idioma público en la rama
centrada en esas responsabilidades. Sustituye las restricciones de alcance de
la primera iteración descrita en [`public-visual-system.md`](public-visual-system.md)
cuando entren en conflicto con esta revisión. Mantiene sus reglas de identidad
aprobada, Sass, movimiento reducido y recursos locales.

Define presentación y navegación frontend. No autoriza cambios de API, análisis,
puntuaciones, criterios legales, certificación, persistencia, worker ni otros
servicios funcionales asignados a otras ramas.

## Objetivo

Hacer que las páginas públicas y el portal expliquen el producto actual con una
identidad corporativa reconocible, una jerarquía visual común y textos que se
entiendan sin conocimientos técnicos. Los mensajes deben servir por igual a
quienes consultan una web y a quienes encargan su desarrollo.

La evidencia determina el lenguaje del informe: cuando una comprobación
acredita que un control no se cumple, el copy lo dice con claridad y explica
sus consecuencias para visitantes y clientes. Un incumplimiento legal solo se
nombra como acreditado cuando lo demuestran directamente la evidencia y el
contrato legal vigente en
[`legal-evidence-and-sanctions.md`](../legal-evidence-and-sanctions.md).

## Superficies incluidas

- Portada pública.
- Portal de consulta e informes, incluidos enlaces directos por URL.
- Metodología.
- Privacidad y alcance.
- Sello e informes.
- Verificación del sello.
- Retirada de la ficha HTML estática de prototipo del recorrido y del paquete
  público. La ficha sirve únicamente como referencia visual durante el rediseño.

El portal informa sobre funciones y estados que ya existen: consulta de una
URL HTTPS completa o una dirección sin esquema (se añade HTTPS), lectura del informe disponible, solicitud de análisis tras
confirmar autorización, estados incompletos o fallidos, historial, categorías,
transparencia pública, auditoría legal acreditada y sello verificable cuando
corresponda. Cada explicación mantiene el alcance real del perfil y de la
evidencia del informe; la UI no cambia cómo se calcula ni almacena nada.

## Alcance de la portada

La portada incluye un bloque de certificaciones públicas, no una lista completa
de destinos consultables. La primera versión muestra únicamente los sitios
certificados `grumphya.com` y `desarrolloseguro.org`, con sus recursos de marca
locales aprobados y un enlace accesible al informe vigente de cada uno. El copy
aclara que el buscador permite consultar cualquier URL válida.

El logotipo de Grumphya se toma del lockup que el usuario ha proporcionado y
que coincide con la marca visible en producción: el wordmark «Grumphya» junto
al SVG `/assets/grumphya/mascot-isotype.svg`. El isotipo se sirve como archivo
local. Se conserva sin alteraciones y se presenta con espacio visual uniforme
en los cuatro lados; no se usa una versión regenerada ni se reconstruye el
dibujo.

El enlace pasa una URL HTTPS completa por un parámetro frontend (`url`) y el
portal la valida con el parser existente. El portal consulta el estado usando
el endpoint público actual y muestra el informe que la API identifique como
vigente para ese destino. No fija un UUID de informe que caduque o quede
obsoleto. La navegación es una lectura `GET`: no solicita ni inicia un
análisis; cualquier solicitud de análisis sigue requiriendo su confirmación
explícita existente. Si no hay informe, se muestra el estado real del portal.

Las menciones de Grumphya fuera de esa presentación de cliente se eliminan de
los textos corporativos. Se conservan las referencias necesarias para
identificar al titular, el dominio o la evidencia en su propio informe,
verificación o sello. No se alteran hechos ni atribuciones de informes
históricos.

La referencia a la ficha de prototipo de la portada desaparece. El informe
dinámico real es el destino para consultar resultados; los sellos del footer y
la búsqueda convencional siguen siendo vías disponibles.

## Identidad y sistema visual

- Se conserva el logotipo aprobado y el turquesa oscuro `#007e79` con su
  variante de contraste `#004b49`. El resto de estilos puede rediseñarse para
  consolidar una identidad corporativa común.
- El erizo del SVG aprobado es la referencia de identidad para nuevas
  ilustraciones. Antes de dibujar variantes se inspecciona visualmente el
  recurso original. Se respetan su silueta, proporciones, rasgos y paleta; no
  se crea un personaje parecido de memoria.
- El erizo sigue siendo un animal. No habla, viste, usa herramientas ni adopta
  gestos o anatomía humanos. Hay poca variación natural de postura; se priorizan
  encuadre, escala, ubicación y contexto ambiental sobre poses nuevas.
- La portada puede incluirlo como acompañamiento visual. En el portal aparece
  solo en momentos puntuales y nunca sustituye etiquetas, instrucciones o
  estados accesibles.
- Se revisan los recursos visuales del prototipo estático para trasladar al
  informe dinámico lo que mejore su lectura: jerarquía editorial, resumen
  destacado, agrupación de categorías, separación entre estado, evidencia,
  fuente y fecha, y una explicación breve de cómo leer la valoración. Los
  valores, afirmaciones y textos del prototipo no se migran como datos actuales.
- En la ficha dinámica se conservan todos los datos, cifras, nombres de
  categorías y clasificaciones existentes tal como los entrega el informe.
  El rediseño puede cambiar su jerarquía, distribución y presentación; no
  puede omitirlos, convertirlos en otros estados, promediarlos de otra forma
  ni sustituirlos por valores del prototipo.
- Las hojas de estilo se escriben exclusivamente en SCSS. No se añaden
  dependencias ni recursos remotos.

## Reglas de copy

1. El texto es comprensible para personas sin formación técnica. Cuando sea
   imprescindible un término técnico, la UI lo explica en lenguaje cotidiano.
2. Se eliminan mensajes repetidos entre hero, avisos, secciones, navegación y
   pies. Cada aviso aparece donde ayuda a decidir o interpretar un resultado.
3. La comunicación nombra como fallo una práctica observada que incumple el
   criterio aplicable; no la disfraza como una mera señal o riesgo. Los
   errores del auditor, la falta de datos y los estados desconocidos se
   identifican como tales y no se atribuyen al sitio.
4. Los incumplimientos legales acreditados se presentan según la especificación
   legal: conducta, evidencia, precepto, organismo competente y multa prevista.
   No se acusa cuando la evidencia no demuestra el hecho.
5. Se explican consecuencias plausibles a corto y largo plazo para las personas
   usuarias y para quien paga el desarrollo: privacidad, seguridad,
   mantenimiento, rendimiento, accesibilidad, cumplimiento legal y costes de
   corregir deuda o daños. No se presentan hipótesis como hechos.
6. No se usan bulos, clickbait, conspiraciones, garantías absolutas ni
   certificaciones implícitas. Una nota, un sello o una comprobación externa
   solo acredita lo que su informe y estado vigente demuestran.
7. Se puede mencionar que Desarrollo Seguro desarrollará o adaptará software
   para clientes bajo transparencia comprobada periódicamente, como dirección
   futura del MVP. No se presenta como un flujo de contratación ya disponible;
   la sección de contacto pertenece a la siguiente fase.

## Límites

- La sección independiente de Actualidad, sus fuentes automáticas, la
  moderación por correo y el análisis de propiedad intelectual quedan
  aplazados y registrados en `wanna-bes.md`.
- No se implementa contacto, cuentas, panel de administración, ingestión de
  noticias, comentarios, ni otros productos o servicios.
- No cambian criterios, ponderaciones, resultado, perfiles, nombres de estado,
  contrato de API, persistencia, admisión de análisis, certificación ni
  evidencia de informes.
- No se añaden cookies no esenciales, analítica, fuentes, iconos, scripts,
  píxeles ni solicitudes a terceros asociadas a la visita de una persona. Los
  logotipos, ilustraciones, estilos y navegación se sirven localmente. Las
  solicitudes de recursos del sitio auditado pertenecen al análisis aislado y
  se explican como parte de su alcance; no se confunden con la carga de la web
  de Desarrollo Seguro.

## Criterios de aceptación

1. Las superficies incluidas comparten identidad visual y vocabulario; el
   recorrido no contiene instrucciones, enlaces o afirmaciones de
   funcionalidades retiradas o inexistentes.
2. La portada identifica esos dos sitios como certificados y no sugiere que sean
   los únicos destinos que se pueden consultar. Presenta los dos logotipos
   aprobados y permite llegar con teclado y lector de pantalla al informe real
   vigente de cada uno. Los enlaces no dependen de UUID fijos, no hacen `POST`
   ni activan un análisis.
3. El portal admite la URL profunda solo si es válida según el parser actual,
   carga el estado por el endpoint público existente y muestra estados reales
   (incluido sin informe o no disponible). Sin `url`, la búsqueda normal
   conserva el mismo comportamiento.
4. La ficha estática del prototipo deja de incluirse en los recursos públicos y
   no queda enlazada desde la portada. La consulta se dirige al informe
   dinámico vigente.
5. El informe dinámico incorpora los recursos visuales del prototipo elegidos
   tras revisar ambas vistas, pero usa exclusivamente datos y estados del
   informe real. Su lectura funciona con informes completos, parciales,
   históricos, no disponibles y con incumplimientos legales acreditados.
6. Las ilustraciones del erizo mantienen los rasgos, silueta, proporciones y
   colores del logotipo aprobado; no son antropomórficas y no dependen de
   recursos externos.
7. El copy diferencia fallo observado, incumplimiento legal acreditado, error
   propio del auditor, limitación y ausencia de evidencia. No presenta
   `unknown`, `not_applicable` o falta de datos como resultado favorable ni
   culpa al sitio por un fallo del auditor.
8. El copy elimina redundancias, define los términos técnicos necesarios y
   comunica impacto en lenguaje claro sin exagerar ni atenuar hechos
   acreditados.
9. No aparecen visitantes, solicitudes, cookies, identificadores o eventos
   transmitidos a nuevos terceros; no se añaden cookies no esenciales,
   analítica ni dependencias externas.
10. La navegación, las ilustraciones, los cuadros de resultados y los estados
    mantienen semántica, contraste y uso por teclado. El movimiento decorativo
    respeta `prefers-reduced-motion`.
11. Lighthouse de laboratorio alcanza al menos 96 en Rendimiento,
    Accesibilidad y Buenas prácticas en escritorio y móvil. SEO se registra
    como informativo mientras la aplicación permanezca bajo `noindex`, de
    acuerdo con [`lighthouse-laboratory.md`](lighthouse-laboratory.md).
12. Tras implementar y verificar, `doc/` describe para personas las páginas,
    el acceso a informes y sus límites; la ficha estática se elimina del
    build. `wanna-bes.md` conserva la idea de Actualidad porque sigue
    aplazada.

## Orden de trabajo

La implementación se divide en cambios pequeños revisables:

1. Portada: copy, identidad y bloque de clientes; resolver el enlace profundo
   por URL en el frontend.
2. Portal: trasladar los patrones visuales seleccionados y revisar el copy de
   búsqueda, estados e informes sin alterar su lógica.
3. Páginas de metodología, privacidad, sello y verificación: alinear
   afirmaciones, navegación e identidad y quitar repeticiones.
4. Retirar el prototipo del build después de confirmar que el informe dinámico
   contiene los recursos visuales seleccionados.
5. Verificación y documentación humana conforme a los gates del proyecto.
