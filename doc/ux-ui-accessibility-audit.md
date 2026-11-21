# Auditoría UX/UI y accesibilidad

Fecha: 18 de noviembre de 2026  
Alcance: portal de consulta (`apps/desarrollo-seguro/web`) y páginas públicas (`desarrollo-seguro/`).

Esta revisión describe la línea base antes de la siguiente propuesta visual. No cambia la funcionalidad ni constituye una auditoría WCAG completa. Las comprobaciones de Lighthouse en escritorio y móvil siguen siendo necesarias antes de aceptar el nuevo diseño.

## Lo que ya está bien encaminado

- Las páginas públicas usan `lang="es-ES"`, `main`, navegación etiquetada, enlace para saltar al contenido y el logotipo local aprobado.
- La navegación pública está separada por páginas y marca la página actual con `aria-current`.
- Los símbolos decorativos del sitio público están ocultos del árbol accesible con `aria-hidden`.
- El portal React tiene nombre visible para el campo de dominio, foco visible, modo oscuro con `aria-pressed`, mensajes de error con `role="alert"` y un progreso indeterminado durante el análisis.
- Existe una variante `prefers-reduced-motion`; debe conservarse en cualquier nueva animación.
- Las peticiones del portal no incluyen credenciales y usan `cache: "no-store"`.

## Hallazgos priorizados

### P1 — Estados de formulario sin asociación completa

Cuando el dominio no es válido, el error se renderiza fuera del formulario como alerta global. El campo no recibe `aria-invalid`, el mensaje no se asocia mediante `aria-errormessage` y el foco no vuelve al campo. Una persona que navega con lector de pantalla puede oír el error sin saber qué control debe corregir.

**Criterio de aceptación:** el error del dominio debe tener un `id` estable, el input debe exponer `aria-invalid="true"` y referenciar ese error, y el foco debe poder volver al input sin perder el contexto. El estado válido debe retirar `aria-invalid`.

### P1 — El progreso no se anuncia al cambiar de fase

`ScanProgress` expone un `progressbar` indeterminado, pero el texto de cola/en curso no está dentro de una región viva. El cambio de `queued` a `running` puede pasar inadvertido para lectores de pantalla. El resultado final tampoco tiene una confirmación accesible específica cuando termina el análisis.

**Criterio de aceptación:** anunciar una vez la cola, el inicio, el fallo y la finalización; evitar anunciar cada consulta periódica. Mantener el progreso indeterminado sin inventar porcentajes.

### P1 — Falta cobertura de viewport móvil y teclado en E2E

Playwright solo ejecuta el proyecto `Desktop Chrome`. La interfaz tiene navegación horizontal en móvil, tarjetas de informe con mucho contenido y un formulario que cambia de disposición; no hay una puerta para 390 px ni una prueba de tabulación y foco visible.

**Criterio de aceptación:** añadir proyectos de escritorio y móvil con `prefers-reduced-motion`, y comprobar en ambos que se puede llegar al buscador, solicitar análisis, abrir evidencias técnicas y recorrer el historial solo con teclado. No aceptar desplazamiento horizontal accidental del documento.

### P2 — Jerarquía de foco y navegación en el portal

El enlace para saltar al contenido apunta al `h1`, no a un contenedor de contenido. Es válido como destino, pero deja la navegación previa y el resultado dinámico fuera de una región principal identificable. El enlace de marca del portal apunta a `/`, que puede sacar a la persona de la sección pública `/desarrollo-seguro/` según el despliegue.

**Criterio de aceptación:** usar un destino de contenido estable y documentar la ruta canónica de vuelta a la presentación pública. Comprobar enlaces desde `/app/` y desde cada página generada bajo `/desarrollo-seguro/`.

### P2 — Legibilidad de textos auxiliares

Hay textos de entre `0.46rem` y `0.72rem` en etiquetas, metadatos, estados y pies. Aunque el contraste de varias combinaciones parece suficiente, los tamaños más pequeños degradan la lectura en móvil y hacen difícil distinguir estados como `OBSERVADO`, `REVISAR` y `SIN DATOS`.

**Criterio de aceptación:** reservar tamaños inferiores a `0.75rem` para identificadores no esenciales; mantener etiquetas de estado y metadatos importantes en un tamaño legible y verificar contraste con Lighthouse/inspección de color.

### P2 — Estados visuales dependen demasiado del color

Los criterios exponen el estado en texto, lo que es correcto, pero la lectura visual se apoya principalmente en coral/acento. El rediseño debe conservar una palabra inequívoca, icono o patrón auxiliar y una diferencia de foco/hover que no dependa solo del color.

**Criterio de aceptación:** cada estado debe seguir siendo comprensible en escala de grises y con daltonismo simulado; `unknown`, `fail` y `pass` deben tener texto visible y no solo color.

### P3 — Verificador del sello durante carga y error

La página del verificador tiene una región viva útil, pero el fallo de red y el sello inválido terminan en el mismo texto `Sello no verificado`. Para la persona usuaria conviene distinguir “no válido” de “no se pudo comprobar ahora”, sin revelar información sensible del token.

**Criterio de aceptación:** mostrar tres estados públicos: comprobando, no verificado y no disponible temporalmente; todos deben ser seguros, breves y accesibles. El enlace al informe solo aparece tras respuesta válida del servidor.

## Pruebas de regresión recomendadas

1. Test unitario del input: dominio inválido activa `aria-invalid`, enlaza el mensaje y permite corregir con teclado.
2. Test unitario del polling: una transición `queued → running → informe` produce como máximo un anuncio por fase y no duplica peticiones.
3. Test de navegador móvil a 390×844: sin overflow horizontal, CTA y checkbox alcanzables, resumen y evidencias legibles.
4. Test de teclado: `Tab`, `Shift+Tab`, `Enter` y `Space` cubren buscador, tema, autorización, solicitud, historial y `details`.
5. Test del verificador: inválido, error de red y válido; en los dos primeros casos el enlace al informe permanece oculto.
6. Lighthouse local, sin red externa: escritorio y móvil, mínimo 96 en Rendimiento, Accesibilidad y Buenas prácticas. SEO se mide y se informa, pero no bloquea `/app/` mientras conserve `noindex`.

## Orden sugerido para la siguiente iteración

1. Cerrar contrato de estados y accesibilidad del buscador antes de cambiar estilos.
2. Añadir la matriz E2E móvil/teclado y los tests de anuncios de estado.
3. Homogeneizar tokens de tipografía y estados en Sass.
4. Ejecutar Lighthouse local y revisar manualmente el foco en el informe largo y el verificador.

