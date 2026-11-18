# Contrato de auditoría interna D-01

La auditoría privada de la etapa D solo puede dirigirse a `grumphya.com` en
`production` y mediante el auditor `desarrollo-seguro`. El contrato compartido
en `core` valida los scopes de infraestructura, aplicación, autenticación,
calidad, privacidad, ética e IA y limita la retención de evidencias a 30 días.

Una evidencia interna contiene únicamente `criterionId`, `scope`, `status`,
`source`, `observedAt` y `reasonCode`. Los criterios y códigos están
allowlisted. No se aceptan HTML, cabeceras completas, cookies crudas, secretos,
identificadores de usuario, texto libre ni destinos alternativos.

Este contrato prepara el adaptador de solo lectura; no abre conexiones, no
concede permisos a Grumphya y no convierte fixtures en evidencias de
producción. El evaluador interno conserva el score externo en `null` y solo
calcula una puntuación interna cuando hay cobertura completa; `unknown` deja
la evaluación incompleta y un fallo crítico la bloquea. D-02 a D-08 requieren
después autorización, recursos y pruebas operativas acotadas.
