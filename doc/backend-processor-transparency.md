# Transparencia de proveedores backend

Los informes nuevos de `grumphya.com` incluyen una comprobación de los
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

El cambio se aplica a `domain-ethics-v4`. Los informes históricos conservan la
rúbrica y evidencia con que se generaron. El despliegue requiere configurar el
auditor y sus claves de acuerdo con
[la guía operativa](../agentic-guidelines/desarrollo-seguro/operations.md#auditor-aislado-de-procesadores-backend).
