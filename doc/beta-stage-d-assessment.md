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

La comprobación posterior del 20 de noviembre de 2026 repitió el preflight
anónimo y obtuvo `internal_audit_resources_ready count=7`. La configuración del
servicio normal continúa en `internal_audit_disabled`, como exige el diseño
opt-in; disponer de las siete rutas protegidas no activa por sí solo una nueva
auditoría ni cambia el informe privado existente. Las suites específicas de
contrato, lector, atestación, puntuación, runner y runtime pasan 39/39 pruebas
locales; la suite completa de core queda en 292 pruebas y la de worker en 289
(una omitida por depender del runtime).

La ejecución privada efímera del 20 de noviembre de 2026 volvió a leer las
siete rutas desde el perfil `internal-audit` del VPS, sin montar PostgreSQL ni
iniciar el stack normal. Produjo `auditRef`
`sha256:a6a4406c8a252e98a4644f462fea9b2c9d8d9200bb488707c7e6bb899ea72ef5`,
`observedAt=2026-11-20T07:55:58.785Z`, estado `incomplete` y cobertura `6/14`.
`internalScore` y `externalScore` permanecieron en `null`; autenticación e IA
alcanzaron `100/100` dentro de su alcance observado, mientras infraestructura,
aplicación, calidad y privacidad conservaron cobertura parcial y ética no tuvo
evidencia. El contenedor terminó tras la lectura y no modificó Grumphya ni la
configuración del servicio normal.

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

La etapa C continúa separada: ya se observó una certificación pública activa
renovada por el scheduler, con informe y puntero de sello nuevos. Esta
evidencia no amplía la cobertura privada D ni convierte sus criterios ausentes
en aprobados.

## Puertas ejecutadas

- Suites de core y worker: 292 pruebas de core y 289 de worker superadas,
  incluido el parser de la envolvente real, la firma EdDSA, scopes, duplicados
  y cancelación.
- TypeScript estricto de core y worker: correcto.
- Workflows de integración y deploy: correctos hasta el despliegue
  `74dff8b` (`44562895405`).
- Smoke privado: `internal_audit_completed`, `6/14`, estado `incomplete`.

Los valores operativos de claves, ACL y secretos permanecen fuera del
repositorio. Esta evidencia es suficiente para considerar operativo el canal
D-08 en modo acotado, pero no para emitir un sello ni una certificación.
