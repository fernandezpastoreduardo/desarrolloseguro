# Evaluación del cierre global de Beta

## Estado de la revisión

### Resultado de cierre global (21 de noviembre de 2026)

La revisión global queda **cerrada para el alcance Beta 0.1 y la auditoría
privada `beta-d-0.2`**. A, B, C y D cuentan con aceptación documentada. La
comprobación pública más reciente de `grumphya.com` terminó el
`2026-11-21T17:28:25.215Z`: informe
`796d5c1b-356f-47ce-8aba-572afd9d18a1`, perfil `domain-v3`, veredicto `pass`,
9/9 controles, CSP válida, Beta 100/100 y certificación `active` cuyo
`certifiedReportId` coincide. El historial público contiene 12 entradas
coherentes. La auditoría privada D aceptada el 20 de noviembre completó las
siete rutas firmadas y 14/14 criterios (`internalScore=100`), sin cambiar el
estado público.

El VPS respondió con salud HTTP correcta para la aplicación y el API; API,
web, worker, scheduler de certificación y scheduler de retención estaban
activos, y PostgreSQL informó versión `19.0`. El despliegue de Grumphya
`44920505995` terminó correctamente y confirmó producción. No se hicieron
cambios en Grumphya ni en el VPS durante esta revisión.

La evaluación ética externa es 100/100 sobre 7 de 8 criterios y permanece
**parcial**: `third-party-data-use` sigue siendo desconocido. Las puntuaciones
externa e interna se conservan separadas y no se inventa una puntuación global
absoluta sin cobertura suficiente. Esta limitación de cobertura no bloquea el
cierre del alcance Beta actual; sí delimita lo que Beta no afirma evaluar.
El MVP queda como fase posterior y no se inicia mediante este cierre.

## Estado previo de la revisión

Esta revisión se ejecuta después de aceptar C y D. No inicia el MVP ni concede
una certificación definitiva por sí sola. La puntuación externa y la interna
se mantienen separadas.

| Área | Evidencia observada | Estado |
| --- | --- | --- |
| A · lectura pública | El endpoint público devolvió el informe `ed8e8b27-ac46-4ad0-91b2-a3e803eb9ab9` con perfil `domain-v3`, 9/9 comprobaciones y 7/8 criterios evaluados. La proyección no expone HTML, cabeceras completas, cookies, IPs ni diagnósticos crudos. | **Operativa; el resultado actual contiene un fallo de cabeceras y no es certificable** |
| B · historial y comparabilidad | `GET /domains/grumphya.com/history` devolvió 12 entradas, dentro del límite, ordenadas por `completedAt` descendente y con el mismo perfil `domain-v3`. Cada UUID resolvió a un informe público coherente con su resumen; el puntero certificado también resolvió. | **Validada operativamente para el alcance Beta** |
| C · auditoría periódica | Renovación programada, recuperación de leases y notificación real del scheduler ya documentadas. | **Aceptada para Beta 0.1** |
| D · auditoría privada | Smoke autenticado de producción: siete rutas firmadas, 14/14 criterios e `internalScore=100`, sin afectar la certificación pública. | **Aceptada para `beta-d-0.2`** |

## Comprobación actual de Grumphya

El informe fresco `ed8e8b27-ac46-4ad0-91b2-a3e803eb9ab9` terminó a las
`2026-11-20T18:03:48.160Z` con:

- `DS-HDR-01`: `fail`, `evidence.csp=false`.
- Evaluación Beta: `70/100`, `eligibility=blocked`.
- Certificación: `suspended`.
- Puntuación externa: `78/100`, 7 de 8 criterios evaluados.

La solicitud fue aceptada como `queued` y terminó sin error de worker, por lo
que la observación no es una reutilización de caché ni un fallo del escáner.

En una lectura HTTP directa posterior, `https://grumphya.com/` sí devolvió una
cabecera CSP válida junto con HSTS, `nosniff`, `X-Frame-Options` y una política
de referencia segura. Esto indica una discrepancia temporal o de ruta entre la
respuesta que produjo el informe y la respuesta actual; no se convierte en un
`pass` hasta obtener un informe nuevo del scanner.

### Diagnóstico reproducible de CSP

Una lectura efímera desde la red `development-security-egress` reprodujo la
cabecera actual. Su `script-src` contiene un nonce, `'strict-dynamic'` y
`https://desarrolloseguro.org`. El rubricado `security-headers-v1` considera
válida una política estricta únicamente cuando `script-src` contiene nonce o
hash junto con `'strict-dynamic'`, sin orígenes de script externos. Por eso la
cabecera existe, pero el scanner la clasifica correctamente como `csp=false`.

El contrato queda protegido por un test TDD que rechaza explícitamente un
origen de script externo aunque haya nonce y `'strict-dynamic'`. El sello debe
cargarse como enlace, imagen o iframe autorizado, o mediante código nonceado
servido por el propio dominio, sin añadir Desarrollo Seguro a `script-src`.

## Condición de salida

El cierre global permanece **pendiente** hasta que un informe fresco posterior
a la corrección confirme simultáneamente:

1. `DS-HDR-01` con `evidence.csp=true`.
2. Evaluación Beta concluyente y puntuación al menos `90/100`.
3. Certificación `active` y `certifiedReportId` coincidente con ese informe.
4. Puntuación externa e interna presentadas por separado, sin calcular una
   puntuación global absoluta si falta cobertura suficiente.

Estas condiciones quedaron satisfechas por el informe fresco del 21 de
noviembre descrito arriba. No se cambió `AUDIT_ENABLED`, el contrato Beta D ni
la certificación desde este repositorio.

## Puertas

El merge documental `aef16e4` pasó el CI `44785083694`: auditoría de
dependencias, integración PostgreSQL, quality gates, Playwright y construcción
y escaneo de imágenes. El deploy quedó omitido porque no había código de
runtime que publicar.
