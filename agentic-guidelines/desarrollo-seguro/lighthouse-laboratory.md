# Lighthouse en laboratorio

## Alcance

El laboratorio Lighthouse se ejecuta localmente sobre la aplicación pública `/app/`, desde un servidor de preview enlazado a loopback. No debe realizar solicitudes a terceros ni transmitir los informes a servicios externos. SEO se calcula y se informa, pero su puntuación no bloquea cambios de Desarrollo Seguro mientras la aplicación conserve `noindex`.

## Criterios de aceptación

- En móvil y escritorio, Rendimiento, Accesibilidad y Buenas prácticas obtienen al menos 96.
- La categoría SEO se incluye en el informe y se muestra como dato informativo; cualquier puntuación es válida para la puerta mientras `/app/` esté marcada `noindex`.
- La puerta falla si falta evidencia de solicitudes de red o si Lighthouse observa una solicitud a un origen externo.
- Las puntuaciones SEO solo vuelven a ser bloqueantes tras una decisión explícita de producto y la actualización de esta especificación.
