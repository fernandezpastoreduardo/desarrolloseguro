# Transparencia de proveedores backend

Los informes nuevos de `grumphya.com` y `desarrolloseguro.org` incluyen una comprobación de los
procesadores que la aplicación activa en sus servicios backend. Esta evidencia
complementa las solicitudes a terceros que Solistos observa en el navegador:
una llamada entre servidores no aparece en la pestaña de red del navegador.

El auditor aislado consulta el inventario privado de Grumphya, verifica su
firma y fecha de vigencia y entrega al worker únicamente una proyección pública
permitida. El informe puede enumerar proveedor, producto, propósito declarado,
declaraciones de privacidad atribuidas a Grumphya y el enlace a la política y su
revisión. No muestra claves, tokens, configuración, solicitudes ni datos de
personas.

Un inventario completo cuyos proveedores están declarados, incluido uno vacío,
aprueba este criterio de transparencia. Un proveedor activo no declarado, un
inventario incompleto o la falta de la capacidad acordada genera un hallazgo.
Si el auditor no puede leer o verificar la evidencia, el resultado queda como
desconocido y no se penaliza al dominio por ese error operativo.

Las declaraciones describen lo que Grumphya publica; el análisis no confirma
contratos ni prácticas reales de los proveedores. Por eso, una declaración
como “no se usa para entrenar modelos” se muestra como declaración de
Grumphya, no como una verificación independiente.

Para `desarrolloseguro.org`, el worker proyecta el registro local y versionado
`development-security-processor-registry.ts`. El resultado se vincula a la
revisión de código que construyó la imagen. La página de privacidad explica su
alcance: integraciones backend que reciben datos de informes o usuarios. Los
destinos técnicos del análisis y la integración condicional con Grumphya quedan
fuera de esa lista. El inventario vacío significa que el código no declara
procesadores externos en ese ámbito; no afirma que no haya proveedores de
infraestructura ni verifica contratos o prácticas de terceros.

El informe guarda esta evaluación junto a la evidencia del análisis. La base de
datos exige que exista para `desarrolloseguro.org` y `grumphya.com` y rechaza
evaluaciones de procesadores adjuntas a otros dominios.

El cambio se aplica a `domain-ethics-v4`. Los informes históricos conservan la
rúbrica y evidencia con que se generaron. El despliegue requiere configurar el
auditor y sus claves de acuerdo con
[la guía operativa](../agentic-guidelines/desarrollo-seguro/operations.md#auditor-aislado-de-procesadores-backend).
