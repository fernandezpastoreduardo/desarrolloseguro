# Normas de trabajo de DesarrolloSeguro.org

Estas normas definen el proceso vigente para todos los agentes y prevalecen sobre cualquier instrucción anterior del repositorio que entre en conflicto. El producto se va a replantear desde cero mediante toma de requisitos y un plan acordado. No se debe empezar a implementar producto mientras ese plan no esté definido.

## Canon del reinicio

1. **La implementación actual es prescindible.** Frontend, backend, infraestructura, persistencia, pruebas, documentación técnica y decisiones de arquitectura pueden descartarse. Si una parte no sirve al plan nuevo, se elimina junto con su código legacy asociado. No se conserva por el coste ya invertido ni se supone que haya que migrarla.
2. **Diseño y arquitectura se vuelven a decidir.** De la identidad visual solo se conservan el logotipo actual y el turquesa oscuro de acento. Los demás estilos, componentes y convenciones visuales pueden cambiar.
3. **SOLID es obligatorio.** Divide las responsabilidades para que el código sea fácil de entender y revisar por una persona, aunque algún archivo resulte breve. No concentres responsabilidades para reducir el número de archivos.
4. **Un patrón nuevo coherente prevalece sobre la historia del código.** Las decisiones o patrones previos no justifican conservar estilos distintos. Cuando se acuerde un patrón para una feature, vista o tipo de responsabilidad, las partes existentes afectadas se refactorizan para seguirlo también. Divide la migración en tareas pequeñas y revisables cuando haga falta; no dejes divergencias solo porque el código sea anterior.
5. **La documentación tiene dos públicos.** `agentic-guidelines/` especifica límites, reglas y contexto operativo para agentes. `doc/` explica el producto y cómo usarlo, desarrollarlo y operarlo a personas. No uses `doc/` como sustituto de especificaciones para agentes.
6. **No se implementa una capacidad sin definición previa.** Antes de escribir código, describe la feature, sus límites, comportamiento y criterios de aceptación en `agentic-guidelines/`. Después de implementarla y verificarla, documenta su uso y comportamiento terminado en `doc/` y elimina de `wanna-bes.md` los elementos que ya se hayan implementado.
7. **`wanna-bes.md` es una lista de ideas aplazadas.** Solo contiene mejoras o cambios que el usuario ha decidido no abordar ahora y quizá quiera hacer próximamente. Al implementar uno, elimínalo de esa lista y documenta el resultado para humanos en `doc/`.
8. **Las hojas de estilo se escriben exclusivamente en SCSS (Sass).**
9. **Dependencias externas: ninguna por defecto.** No instales una librería sin autorización explícita del usuario, aunque parezca conveniente. Antes de proponerla, revisa y explica sus términos, aviso legal, coste y comportamiento de cookies, telemetría y transmisión a terceros; debe ser gratuita sin que la versión gratuita cambie esas condiciones. Si incumple privacidad, seguridad o calidad, no se incorpora: se implementa una alternativa propia bajo los criterios del proyecto. Esta regla se aplica a librerías funcionales, de procesamiento, interfaz, animación y cualquier otra clase.
10. **No rellenes huecos de concepto por inferencia.** Si una petición tiene ambigüedades que afectan al producto, alcance, interacción, arquitectura o resultado visual, detén la implementación y haz preguntas concretas con una breve explicación de por qué hace falta cada respuesta.
11. **Lo que se define desde cero requiere toma de requisitos, de una pregunta por turno.** Mantén una secuencia de preguntas y respuestas hasta tener información suficiente para producir un plan concreto. Formula solo una pregunta cada vez y espera la respuesta antes de plantear la siguiente. No conviertas supuestos en requisitos ni agrupes un cuestionario en un solo mensaje.
12. **Regla tras iteraciones fallidas.** Si el desarrollador indica por segunda vez que una iteración sobre la misma tarea no cumple lo pedido, no hagas una tercera iteración probabilística. Pregunta por los criterios que faltan y solicita referencias útiles —por ejemplo, imágenes, URL o código de ejemplo— antes de continuar. Esta regla es canónica.
13. **No desplegar ni ejecutar GitHub Actions.** El agente no tiene permiso para desplegar ni para iniciar workflows. Si una tarea lo requiere, solicita autorización explícita; cuando no sea imprescindible, el desarrollador hará los despliegues desde la interfaz de GitHub Actions.
14. **Prevalencia.** Si estas normas nuevas chocan con guías anteriores, prevalecen estas normas. Las especificaciones existentes describen la versión anterior y no son requisitos del producto nuevo.
15. **Calidad estática y de laboratorio desde el inicio.** El trabajo debe partir de una instalación local de SonarQube Community. Si no existe, su preparación se incluye entre las primeras tareas acordadas. Añade pruebas de Lighthouse ejecutadas en laboratorio y compatibles con privacidad, seguridad y ausencia de seguimiento externo.
16. **Umbral obligatorio de Lighthouse.** Cada categoría evaluada (Rendimiento, Accesibilidad, Buenas prácticas y SEO) debe obtener al menos 96 tanto en escritorio como en móvil. Un resultado inferior en cualquier categoría o dispositivo bloquea el push. No reduzcas el umbral ni excluyas una categoría sin instrucción explícita del desarrollador.
17. **Tareas de tamaño excesivo.** Si una petición resulta demasiado amplia para ejecutarla y revisarla con seguridad en una sola tarea, recházala como unidad de implementación, explica brevemente el motivo y propón un plan ordenado en tareas pequeñas. No empieces una de ellas hasta que el usuario indique cuál abordar, salvo que ya haya autorizado expresamente esa secuencia.

## Proceso para cada cambio

1. Contrasta la petición con el plan vigente y aclara cualquier hueco de concepto.
2. Define o actualiza primero la feature en `agentic-guidelines/`, con alcance, reglas y criterios de aceptación revisables.
3. Divide el trabajo en cambios pequeños y aprobables. Cada cambio debe respetar SOLID, privacidad, seguridad y las reglas de dependencias.
4. Implementa y verifica solo el alcance acordado. No despliegues ni ejecutes GitHub Actions.
5. Al terminar, actualiza `doc/` para el público humano y limpia `wanna-bes.md` de aquello que ya se haya implementado.

## Repositorio y cambios existentes

- No trates código, tests, documentación o configuración actuales como contratos. Comprueba su propósito y su relación con la feature acordada antes de conservarlos.
- No sobrescribas cambios locales preexistentes que no formen parte de la tarea solicitada.
- No publiques el repositorio ni cambies su visibilidad como efecto colateral de una tarea de implementación; la publicación requiere una tarea explícita y una revisión previa del contenido que se expondrá.
