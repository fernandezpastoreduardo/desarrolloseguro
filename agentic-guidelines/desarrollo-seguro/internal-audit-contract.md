# Contrato de auditoría interna D-01

La auditoría privada de la etapa D solo puede dirigirse a `grumphya.com` en
`production` y mediante el auditor `desarrollo-seguro`. El contrato compartido
en `core` valida los scopes de infraestructura, aplicación, autenticación,
calidad, privacidad, ética e IA y limita la retención de evidencias a 30 días.

Una evidencia interna contiene únicamente `criterionId`, `scope`, `status`,
`source`, `observedAt` y `reasonCode`. Los criterios y códigos están
allowlisted. No se aceptan HTML, cabeceras completas, cookies crudas, secretos,
identificadores de usuario, texto libre ni destinos alternativos. El snapshot
de infraestructura D-02 solo conserva nombres seguros, digests SHA-256,
exposición, privilegios y estado de transporte; nunca comandos, rutas,
variables de entorno o datos de bases. La atestación D-03 solo conserva
digests SHA-256 y códigos de controles allowlisted; no recibe SBOM completo,
código fuente ni secretos.

El adaptador de acceso D-01 autoriza únicamente operaciones `GET` contra
recursos allowlisted y rutas sin query, fragmento, salto de directorio ni
credenciales. No abre conexiones por sí mismo, no concede permisos a Grumphya
y no convierte fixtures en evidencias de producción. El evaluador interno conserva el score externo en `null` y solo
calcula una puntuación interna cuando hay cobertura completa; `unknown` deja
la evaluación incompleta y un fallo crítico la bloquea. D-02 a D-08 requieren
después autorización, recursos y pruebas operativas acotadas.
