# Revisión técnica de Grumphya en la ficha pública

La ficha pública de `grumphya.com` incluye un bloque independiente con los 14 aspectos que comprueba la auditoría interna de Desarrollo Seguro. Grumphya ha decidido compartir esta parte para que sus usuarios conozcan mejor cómo funciona y se protege la aplicación. Los aspectos aparecen agrupados en conexión y protección, aplicación y acceso, uso y experiencia, y datos e información. Cada uno muestra un estado y una explicación breve, dirigida al público general.

El bloque no presenta la puntuación interna, los pesos ni métricas o detalles de la evidencia privada. Tampoco modifica las notas Ética y Privacidad, la puntuación global, la certificación o el sello.

El worker solicita la revisión en cada informe periódico o bajo demanda. Un auditor aislado conserva las credenciales, lee únicamente recursos autenticados permitidos y entrega al worker una proyección limitada a identificadores, estados y fecha. No tiene acceso a PostgreSQL. El informe guarda esa proyección como parte inmutable del resultado.

Los estados significan:

- **Correcto:** la comprobación observada no encontró un problema dentro de su alcance.
- **Atención:** se confirmó una condición que podría tener el impacto indicado. El informe no afirma que haya ocurrido un daño.
- **No aplica:** la comprobación no corresponde a la configuración observada.
- **En revisión:** no hay un resultado vigente para mostrar. Puede ocurrir si la evidencia caducó o el auditor no pudo completar la lectura. No se reutilizan como actuales resultados anteriores.
- **Pendiente:** el informe se está actualizando; aparecerá un único indicador animado y los 14 aspectos quedarán pendientes hasta que termine.

El indicador de actividad aparece mientras se registra una solicitud, esta espera turno o el análisis está en marcha. No muestra un porcentaje inventado. Cuando la revisión termina, se muestra el resultado; si no hay un resultado vigente, «En revisión» permanece estático.

Las explicaciones describen posibles efectos para las personas, no son instrucciones de desarrollo ni una garantía absoluta de seguridad. «Ética» no es una opinión moral: resume la transparencia y las señales públicas sobre prácticas que pueden afectar a las personas. La ficha separa las declaraciones del titular de lo que el análisis observa. La falta de información pública exigible se considera un fallo de transparencia; si un error técnico del auditor impide completar una comprobación, queda en revisión sin atribuir el fallo al dominio. La nota global se explica una sola vez: combina por igual Ética y Privacidad; los aspectos que el auditor no pudo comprobar no suman a favor ni en contra.
