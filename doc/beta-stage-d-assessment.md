# Evaluación operativa de la etapa D de la Beta

## Alcance de esta comprobación

Esta página registra la primera ejecución autorizada de la auditoría privada
de `grumphya.com` desde Desarrollo Seguro. No certifica Grumphya, no cambia su
estado público y no mezcla la puntuación interna con la externa. La ejecución
solo lee las siete rutas del contrato `beta-d-0.2` mediante el JWT técnico y
valida la atestación EdDSA de cada respuesta.

## Evidencia operativa

La ejecución del 19 de noviembre de 2026 completó las siete lecturas y produjo
un informe privado con estas propiedades:

- `policyVersion`: `beta-d-0.1`.
- `hostname`: `grumphya.com`.
- `environment`: `production`.
- estado: `incomplete`.
- criterios evaluados: `6/14`.
- `internalScore`: `null` porque la cobertura no es suficiente.
- `externalScore`: `null` por contrato; la puntuación pública se conserva aparte.
- categorías con evidencia concluyente: autenticación e IA (`100/100` cada una
  dentro de su alcance observado).
- categorías con cobertura parcial: infraestructura, aplicación, calidad y
  privacidad.
- categoría sin evidencia concluyente: ética.

La repetición controlada del 19 de noviembre a las 20:53 (hora de Madrid)
volvió a completar las siete lecturas desde el runner one-shot del VPS. Su
`auditRef` fue `sha256:60db0358839fd3f00bd7db273eb61a53d000a252c7b66094d3775aacf89a96a7`
y mantuvo exactamente el mismo resultado `incomplete`, con `6/14` criterios,
`internalScore: null` y sin modificar el stack normal. La preflight anónima
posterior confirmó las siete rutas JSON (`internal_audit_resources_ready
count=7`); los rechazos públicos `403 insufficient_scope` siguen siendo el
comportamiento esperado fuera de la red y del JWT técnico.

El resultado demuestra que el canal operativo funciona; el estado incompleto
es deliberado. La ausencia de una señal no se convierte en un aprobado ni en
una penalización inventada. El informe solo proyecta controles para los que la
respuesta firmada aporta evidencia allowlisted.

## Controles demostrados

1. El JWT usa `iss=desarrolloseguro-audit`, `aud=grumphya-audit`,
   `sub=desarrolloseguro-audit`, `environment=production`,
   `domain/hostname=grumphya.com`, `kid` vigente y un `jti` nuevo por lectura.
2. Cada operación usa únicamente `GET` y el scope exacto del recurso.
3. El lector rechaza respuestas HTML, redirecciones, firmas inválidas,
   cardinalidades inesperadas, ventanas caducadas y evidencia futura.
4. La atestación de release se valida con la clave pública allowlisted de
   `grumphya-release-2026`.
5. La proyección evita duplicar criterios: el control de Trivy de deployment no
   se cuenta de nuevo como inventario de dependencias.
6. El resumen JSONL solo publica estado, cobertura, categorías y referencias
   hash; no incluye evidencias, cabeceras, cookies, tokens ni datos del dominio.

## Límites restantes

La ejecución no observa todavía cabeceras completas, red/privilegios,
consentimiento real, cookies dinámicas, rendimiento de navegador ni controles
éticos no expuestos por el contrato. Esas ausencias mantienen el informe en
`incomplete` y el score interno en `null`. Para ampliar la cobertura habría que
acordar nuevos datos allowlisted con Grumphya y repetir la validación, sin usar
fixtures como evidencia de producción.

La etapa C continúa separada: falta observar una certificación pública activa
que venza y sea renovada por el scheduler, incluyendo la actualización del
informe y del sello. Esta carencia no invalida la ejecución privada D.

## Puertas ejecutadas

- Suites de core y worker: 283 pruebas superadas, incluido el parser de la
  envolvente real, la firma EdDSA, scopes, duplicados y cancelación.
- TypeScript estricto de core y worker: correcto.
- Workflows de integración y deploy: correctos hasta el despliegue
  `74dff8b` (`44562895405`).
- Smoke privado: `internal_audit_completed`, `6/14`, estado `incomplete`.

Los valores operativos de claves, ACL y secretos permanecen fuera del
repositorio. Esta evidencia es suficiente para considerar operativo el canal
D-08 en modo acotado, pero no para emitir un sello ni una certificación.
