# Guías para agentes

Lee primero [`../AGENTS.md`](../AGENTS.md): contiene el proceso obligatorio, los límites de actuación y las reglas de prevalencia para el reinicio del proyecto.

## Fuente de verdad

- Las features nuevas se definen aquí antes de implementar cualquier código.
- Cada definición debe precisar propósito, alcance, exclusiones, comportamiento, privacidad, seguridad y criterios de aceptación; pregunta al usuario por lo que no esté definido.
- Las guías y especificaciones existentes bajo `desarrollo-seguro/` describen la implementación anterior. Son material histórico que se puede consultar para entenderla, pero no son requisitos ni restricciones para la nueva arquitectura.
- `doc/` se mantiene para explicar a personas el producto y sus procedimientos. Al finalizar una feature se actualiza allí la documentación del comportamiento nuevo.
- `wanna-bes.md` solo registra elementos que el usuario haya aplazado expresamente; se limpia cuando se implementan.

No conviertas descripciones de código existente, decisiones antiguas o supuestos del agente en requisitos del producto nuevo. Si hace falta decidirlos, incorpóralos a la toma de requisitos.
