# Transparencia de procesadores backend

Los informes nuevos de `grumphya.com` y `desarrolloseguro.org` incluyen una comprobación de integraciones backend. Los informes históricos conservan su versión y evidencia originales.

Para Grumphya, el auditor aislado lee la declaración autenticada del dominio, comprueba firma y vigencia y proyecta al informe solo los campos permitidos. La información se atribuye a Grumphya y no verifica sus contratos ni las prácticas reales de los proveedores.

Para Desarrollo Seguro, el worker usa el registro local y versionado [`development-security-processor-registry.ts`](../apps/desarrollo-seguro/worker/src/development-security-processor-registry.ts), ligado a la revisión de código usada para construir la imagen. En v2, el registro declara IONOS como proveedor del VPS que aloja la web pública, la API y la base de datos. La [política de privacidad](../desarrollo-seguro/politica-de-privacidad.html#ionos-hosting) enlaza los documentos oficiales de IONOS. La declaración no acredita por sí sola condiciones contractuales, prácticas ni plazos concretos de conservación.

Los destinos que reciben comprobaciones técnicas solicitadas se clasifican como destinos del análisis y no como procesadores de los datos de la aplicación. La consulta autenticada al inventario de Grumphya se activa al analizar Grumphya y no se atribuye a la web pública de Desarrollo Seguro. Ningún dato de OpenAI se afirma mientras el runtime del producto no tenga una integración que le transmita datos.

Una declaración solo aprueba cuando está ligada a una revisión de producción reconocida, se valida con el esquema de inventario y todos los proveedores activos están publicados. Revisión ausente o evidencia no válida queda como `unknown`. Los informes atribuyen el registro propio a Desarrollo Seguro.
