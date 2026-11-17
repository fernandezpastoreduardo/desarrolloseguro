# Toma de requisitos inicial — Desarrollo Seguro

> **Estado:** documento inicial de producto, 17 de noviembre de 2026.  
> **Naturaleza:** decisiones de alcance y comportamiento acordadas en conversación. **No** demuestra que las funcionalidades estén implementadas, que exista una certificación operativa ni que se hayan superado controles.  
> **Ámbito:** MVP y evolución posterior. Especificaciones técnicas, criterios de aceptación y requisitos normativos concretos deberán desarrollarse antes de implementar cada capacidad.

## 1. Propósito y principios

Desarrollo Seguro aspira a evaluar aplicaciones web mediante controles técnicos verificables y un **sello dinámico asociado a un dominio**, con una ficha oficial accesible desde `desarrolloseguro.org`.

La evaluación debe basarse en **evidencias observables**, no en suposiciones sobre marcas, herramientas o bibliotecas. Seguridad, privacidad, calidad técnica, rendimiento y ética son ámbitos de evaluación mencionados inicialmente; su catálogo definitivo de criterios, pesos, umbrales y consecuencias aún requiere especificación.

Principios transversales:

- **No confundir ausencia de evidencia con conformidad ni con incumplimiento.**
- Evaluar **el uso y la configuración efectivos** de cada tecnología, además de las características comunes de su proveedor.
- Preservar los resultados comprobados aunque otra parte de la evaluación esté pendiente.
- Minimizar el impacto de las auditorías sobre la infraestructura del cliente.
- Reutilizar información común cuando sea aplicable, manteniendo el análisis contextual de cada aplicación.
- Mantener trazabilidad, versionado del estándar y control humano sobre sus cambios.

## 2. Motor de auditoría y base de conocimiento

### 2.1 Catálogo incremental

- El MVP comenzará por **integraciones y servicios ampliamente utilizados**; el catálogo crecerá progresivamente.
- El motor intentará detectar las integraciones relevantes en producción y contrastarlas con las capacidades del catálogo, **sin asumir que toda dependencia detectada se ejecuta en producción**.
- El catálogo distinguirá **proveedor, producto, modalidad de despliegue, versión y configuración o condiciones de utilización relevantes**, cuando proceda.
- Se podrán reutilizar entre clientes evaluaciones y evidencias comunes de proveedores si **siguen vigentes** y las condiciones aplicables son equivalentes.
- La integración concreta en cada aplicación se comprobará **individualmente**; una evaluación favorable del proveedor no aprueba automáticamente sus usos.

**Ejemplos orientativos:** el comportamiento de Sentry depende de la configuración y de los datos capturados y enviados; su mera presencia no permite declarar automáticamente cumplimiento o incumplimiento legal. Una instalación local de SonarQube Community utilizada únicamente como puerta de calidad durante el desarrollo, sin componentes ni comunicaciones añadidos en producción, no debe confundirse con un servicio externo integrado en la aplicación desplegada.

### 2.2 Resultados y cobertura

Las comprobaciones específicas deberán distinguir entre:

- **Evaluada conforme:** evidencia suficiente de cumplimiento del requisito concreto.
- **Incumplimiento detectado:** evidencia suficiente del requisito incumplido.
- **No evaluable / pendiente:** catálogo o evidencias insuficientes; **ni aprobado ni suspenso**.

Si una integración desconocida afecta a parte de la evaluación:

- La **puntuación o estado global** quedará **«En revisión»**, sin presentar una nota global definitiva.
- Las **categorías suficientemente verificadas** conservarán sus puntuaciones.
- Una categoría afectada podrá presentar resultados parciales, indicando claramente qué criterios faltan por comprobar.
- **«En revisión» no equivale a «Certificado»** para una solicitud nueva que todavía no dispone de sello.
- Una aplicación **previamente certificada** conservará provisionalmente su sello mientras se investiga una integración desconocida, **siempre que no se haya acreditado un incumplimiento eliminatorio**. Si se confirma un incumplimiento crítico que invalida la certificación, el sello deberá suspenderse.

Los criterios exactos para calificar un incumplimiento como eliminatorio y los requisitos de concesión inicial deberán formalizarse por separado.

### 2.3 Investigación de tecnologías desconocidas

Cuando el motor encuentre una librería, API, proveedor o servicio que no pueda analizar adecuadamente:

1. Registrará la identidad del componente, su contexto de uso, las evidencias disponibles y los controles pendientes.
2. Marcará las comprobaciones afectadas y el estado global según corresponda.
3. Enviará un **aviso interno por correo electrónico** en el MVP. Los avisos relacionados se **agruparán** para evitar duplicados innecesarios.
4. El equipo de Desarrollo Seguro investigará, ampliará el catálogo y añadirá las comprobaciones necesarias.
5. Mantendrá la revisión abierta hasta disponer de evidencias suficientes.

El trabajo se priorizará según **importancia, riesgo y complejidad**, **sin plazo máximo obligatorio** durante el MVP. En una fase posterior se podrá gestionar mediante un **panel de administración**.

### 2.4 Actualizaciones y reevaluación

- Al incorporarse una nueva evaluación al catálogo, se identificarán las aplicaciones afectadas.
- **No se adelantarán auditorías automáticamente** por ese motivo: se reevaluarán en el **siguiente ciclo ordinario** de cada aplicación, conservando el calendario establecido.
- Se reutilizarán las evidencias comunes, pero se volverá a valorar la **configuración y el uso particular** de cada aplicación.
- La existencia de un hallazgo crítico acreditado no deberá ocultarse ni considerarse aprobado por estar pendiente otro control.

## 3. Seguridad y eficiencia de las comprobaciones

El motor no se diseñará como un rastreador agresivo ni como una batería indiscriminada de peticiones.

- Priorizará **pruebas no destructivas, menos costosas y suficientemente concluyentes**.
- Ejecutará comprobaciones en un **orden lógico**, con dependencias y condiciones: una prueba podrá hacer innecesarias otras.
- La evidencia suficiente de un resultado permite omitir técnicas redundantes, **pero no omitir requisitos obligatorios**.
- Ante indicios de que continuar una rama pueda perjudicar la producción del cliente, **se interrumpirá preventivamente** y se documentará qué quedó sin comprobar.
- Existirán **límites defensivos de tiempo, peticiones y recursos** como salvaguarda, aunque el diseño habitual de las pruebas deba evitar alcanzarlos.
- Una prueba no ejecutada por riesgo no demuestra por sí sola incumplimiento del sistema auditado.
- Se conservará trazabilidad de **pruebas realizadas, omitidas, motivos, evidencias y resultados**.

## 4. Sello verificable y ficha pública

### 4.1 Sello insertado en el dominio certificado

- El sello será **dinámico**, enlazado a una certificación y a sus **dominios autorizados**.
- Mostrará **estado vigente** y **fecha o información de la última comprobación**.
- Incorporará de forma **siempre visible**, también en móviles, una invitación como **«Haz clic para verificar este sello»**; no dependerá de hover.
- **Todo el sello será pulsable** y enlazará con una **ficha oficial alojada en `desarrolloseguro.org`**.
- Tendrá **dimensiones fijas** definidas por su diseño, sin deformación; se deberá garantizar su legibilidad y accesibilidad. El tamaño exacto queda pendiente de diseño.
- Se integrará mediante un **fragmento de código proporcionado por Desarrollo Seguro**, que el cliente no tenga que modificar cuando cambie el estado.
- Si la certificación deja de estar vigente, el sello **desaparecerá visualmente por completo**, sin sustituirlo por una advertencia.
- Si se recupera la vigencia, el sello **reaparecerá automáticamente** sin intervención sobre la web del cliente.

### 4.2 Verificación y prevención de suplantaciones

La ficha oficial será la **referencia autoritativa** y mostrará, como mínimo, el **dominio al que está asignada la certificación**, su estado, la última comprobación y el detalle de resultados publicables.

No será suficiente presentar un identificador o una imagen copiados de otra web. El diseño del mecanismo deberá vincular el sello a los dominios autorizados y facilitar la detección de reutilizaciones indebidas. **No puede garantizarse impedir que terceros copien una imagen estática**; por ello la comprobación en la ficha oficial es indispensable.

La implementación debe considerar rendimiento, accesibilidad y privacidad y **no depender exclusivamente de JavaScript del navegador** para definir la autenticidad. El mecanismo exacto de incrustación, validación y actualización queda por diseñar y verificar.

## 5. Gobierno y mantenimiento del estándar

- Se prevén **auditorías ordinarias aproximadamente cada hora**, respetando los intervalos ya establecidos para evitar un patrón totalmente predecible.
- Los cambios de legislación, amenazas o requisitos del estándar se aplicarán en el **siguiente ciclo ordinario**; no desencadenarán de forma general una auditoría extraordinaria.
- Cada versión del estándar debe permitir reconstruir **qué reglas se aplicaron a cada evaluación**.
- Se publicará un **historial accesible de cambios** que indique **qué cambió, cuándo y por qué**.
- El MVP **no notificará automáticamente a todas las empresas** por cada modificación del estándar.
- Si durante una auditoría un cambio causa un **fallo de certificación**, se emitirá un **correo interno** para valorar y gestionar el caso de forma individual. La gestión humana de la incidencia no debe falsear el estado técnico ni retrasar indebidamente una suspensión que corresponda.
- **Toda modificación del estándar requiere revisión y aprobación humana previa** a su publicación y entrada en vigor, incluso si la sugerencia se origina automáticamente.

## 6. Límites del acuerdo y pendientes

Este documento representa una **toma de requisitos inicial**, no una especificación cerrada ni una orden para desarrollar todo de una sola vez. Antes de implementar, se deberán concretar al menos:

- Inventario y priorización de tecnologías que cubre el MVP, pruebas, fuentes de evidencia, caducidad y equivalencia de configuraciones.
- Requisitos definitivos por categoría, cálculo de puntuaciones y reglas de certificación, suspensión y recuperación.
- Política de cadencia exacta, fallos de ejecución, reintentos, protección de infraestructura y tratamiento de incidencias urgentes.
- Diseño definitivo del sello, sus medidas, integración, validación por dominio, controles antisuplantación y ficha pública.
- Datos públicos y privados de las fichas, conservación de evidencias y requisitos de protección de datos.
- Canales, destinatarios, deduplicación y contenido seguro de los correos internos.
- Flujo de propuesta, revisión, aprobación, publicación y versionado del estándar.
- Criterios de aceptación y pruebas automatizadas para cada requisito.

**Relación con el código actual:** el README del repositorio describe una fase académica de observación y presentación de evidencias, sin certificación operativa ni escaneo completo activado. **Este documento describe el producto objetivo y las decisiones iniciales del MVP**, y no sustituye ese estado real ni autoriza a presentar el sello como una certificación ya implementada.

**Regla de evolución:** toda decisión posterior deberá quedar registrada y, si contradice una de estas premisas, el documento deberá actualizarse explícitamente; una decisión histórica no obliga a mantener patrones técnicos obsoletos o inconsistentes.
