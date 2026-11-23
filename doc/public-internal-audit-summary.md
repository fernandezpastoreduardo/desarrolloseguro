# Revisión técnica de Grumphya en la ficha pública

La ficha pública de `grumphya.com` incluye un bloque independiente con los 14 aspectos que comprueba la auditoría técnica privada de Desarrollo Seguro. Cada aspecto muestra un estado y una explicación breve, dirigida al público general.

El bloque no presenta la puntuación interna, los pesos ni métricas o detalles de la evidencia privada. Tampoco modifica las notas Ética y Privacidad, la puntuación global, la certificación o el sello.

El worker solicita la revisión en cada informe periódico o bajo demanda. Un auditor aislado conserva las credenciales, lee únicamente recursos autenticados permitidos y entrega al worker una proyección limitada a identificadores, estados y fecha. No tiene acceso a PostgreSQL. El informe guarda esa proyección como parte inmutable del resultado.

Los estados significan:

- **Correcto:** la comprobación observada no encontró un problema dentro de su alcance.
- **Atención:** se confirmó una condición que podría tener el impacto indicado. El informe no afirma que haya ocurrido un daño.
- **No aplica:** la comprobación no corresponde a la configuración observada.
- **En revisión:** la comprobación está ejecutándose, la evidencia no está vigente, falta cobertura suficiente o el auditor no pudo completar la lectura. No se reutilizan como actuales resultados anteriores.

La ficha muestra «En revisión» durante la renovación del informe y cuando esta falla. El estado se actualiza al completarse el siguiente análisis válido.

Las explicaciones de posibles impactos no son instrucciones de desarrollo ni una garantía absoluta de seguridad. Las comprobaciones se limitan a las señales disponibles en el contrato técnico de Grumphya y no sustituyen una auditoría exhaustiva.
