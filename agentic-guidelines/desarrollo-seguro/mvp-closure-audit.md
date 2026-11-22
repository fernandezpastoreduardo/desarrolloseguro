# Auditoría y plan de cierre del MVP

> **Corte:** 22 de noviembre de 2026.
> **Estado:** auditoría técnica local completada; cierre de producto pendiente.
> **Propósito:** distinguir evidencia comprobada de decisiones aún abiertas. Este
> documento no añade requisitos de producto ni autoriza implementar las áreas
> pendientes.

## Alcance y regla de cierre

El cierre del MVP se evalúa contra [`doc/requisitos-iniciales-mvp.md`](../../doc/requisitos-iniciales-mvp.md)
y las especificaciones vigentes de `agentic-guidelines/desarrollo-seguro/`.
Un requisito solo se considera cerrado con evidencia de implementación y
pruebas reproducibles. Las decisiones que el documento de requisitos marca
como pendientes no se completan por inferencia.

No forma parte de este objetivo cambiar Grumphya ni otros dominios o servicios.
No se desplegó ni publicó ningún cambio durante esta auditoría.

## Evidencia comprobada

- El workflow de deploy contiene un smoke que exige que el informe propio
  obtenga `domain-ethics-v4` con 8/8, y Ética, Privacidad y Global en 100/100.
  La evaluación histórica de Beta en `doc/beta-global-closure-assessment.md`
  conserva un resultado anterior de 7/8; no prueba el estado actual posterior
  al cambio. El deploy `45069829676` pasó el smoke que exige el resultado propio
  con 100/100 en Ética, Privacidad y Global y evidencia versionada de
  procesadores.
- Solistos v1 está integrado en análisis manuales y programados, con rúbrica,
  persistencia, evidencia pública y límites especificados en
  `solistos-phase.md` y `doc/solistos-privacy.md`.
- La evidencia pública de Privacidad incluye nombres de cookies, proveedores
  identificados y dominios de terceros. El worker limita y sanea esas listas,
  el esquema público las valida y la ficha renderiza las tres; no incluye
  valores de almacenamiento.
- El sello dinámico, la ficha pública y su verificación tienen implementación
  y pruebas de política locales.
- El API selecciona `domain-ethics-v4` cuando un informe incluye evaluación de
  procesadores backend; si no la incluye, conserva `domain-ethics-v3`. Ambas
  versiones usan la misma integración global 50/50 con `privacy-v1`. La
  documentación humana y la especificación Solistos ya reflejan esta
  compatibilidad; la persistencia actual limita esa evaluación a los dominios
  autorizados en la migración.
- `pnpm ci:verify quality`: **pasa** al ejecutarlo fuera del sandbox. Incluye
  migraciones, políticas, lint, tipos, suites unitarias, build y verificación
  del aislamiento Docker. En sandbox, cuatro pruebas HTTP fallaron únicamente
  al abrir `127.0.0.1` por `EPERM`; el reintento autorizado fuera del sandbox
  pasó.
- `pnpm ci:verify postgres`: **pasa** con PostgreSQL 19 efímero enlazado a
  `127.0.0.1:55432`; persistencia 96/96 y worker 1/1. El contenedor se eliminó
  al finalizar.
- `pnpm test:e2e`: **pasa**, 4/4.
- `pnpm test:lighthouse`: móvil y escritorio obtienen Rendimiento 100,
  Accesibilidad 100 y Buenas prácticas 100. SEO obtiene 63 en ambos; permanece
  informativo porque `/app/` conserva `noindex`, según el gate y la decisión
  registrados en `doc/ci-cd.md`.
- La política local de auditoría de dependencias pasa. `pnpm ci:verify audit`
  no llegó a producir resultado porque el acceso al registro npm quedó sin
  respuesta; se interrumpió la espera.
- `pnpm quality:sonar`: **pasa** en SonarQube Community Build local 26.10.0;
  generó cobertura y devolvió `QUALITY GATE STATUS: PASSED`. La instancia ya
  estaba activa desde el worktree `main` del mismo repo y solo escucha en
  loopback. El intento de levantar una segunda instancia en este worktree
  encontró el puerto ocupado; se retiraron únicamente los contenedores y redes
  temporales creados por ese intento.
- GitHub, consultado mediante el conector, no muestra PRs ni issues abiertos.
  El workflow `45069450845` terminó correctamente con quality, PostgreSQL,
  Playwright/Lighthouse, auditoría de dependencias e imágenes; su job de deploy
  fue omitido. El workflow `45069829676` terminó correctamente con esos mismos
  gates y **Deploy Desarrollo Seguro**. El deploy confirmó salud pública, la
  redirección canónica y el smoke del informe propio con 100/100 en Ética,
  Privacidad y Global y evidencia versionada de procesadores.
- No se hicieron cambios de código ni deploys. Esta auditoría y la aclaración
  de versiones de puntuación en requisitos/guía humana son cambios
  documentales en la rama preparada para revisión.

## Brechas verificadas contra requisitos del MVP

### Trazabilidad por sección

| Requisito | Estado con evidencia del repo | Evidencia / límite |
| --- | --- | --- |
| §2.1 Catálogo incremental | Parcial | Existe el catálogo pasivo OCKD y el dinámico Solistos; su alcance efectivo y calidad están acotados en la siguiente brecha. No hay inventario inicial aprobado para el resto de tecnologías del MVP. |
| §2.2 Estados, cobertura y puntuación | Implementado para los perfiles actuales | `domain-ethics-score.ts`, `privacy-score.ts`, `global-score.ts` y pruebas cubren `unknown`, `not_applicable`, nota parcial y «En revisión». No acredita que el catálogo de criterios del MVP esté completo. |
| §2.3 Investigación de tecnologías desconocidas | Pendiente | No se encontró registro operativo de revisión ni transporte de correo. Faltan destinatarios, deduplicación, contenido seguro y priorización ejecutable. |
| §2.4 Reevaluación tras cambios del catálogo | Parcial | Los schedulers mantienen ciclos ordinarios y no adelantan auditorías por una actualización. No hay mecanismo explícito de identificar/publicar el conjunto de dominios afectados por una actualización de la base. |
| §2.5 Solistos y puntuación global | Implementado con versiones Ética compatibles | `privacy-v1` conserva dimensión y cobertura separadas; la política global combina 50/50 las versiones Ética v3 o v4 según el informe, y deja la global en revisión ante `unknown`. |
| §3 Seguridad y eficiencia de pruebas | Implementado en buena parte; producción no revalidada aquí | Los límites, proxy, aislamiento, políticas de solicitud y pruebas locales pasan. Esta auditoría no volvió a probar firewall/egress real del VPS ni a medir impacto en producción. |
| §4.1 Sello dinámico | Implementado para los dominios autorizados actuales | `doc/report-badges.md`, widget/API y pruebas cubren estado, frescura, ocultación/reactivación y enlace verificable. Las dimensiones visuales finales siguen sin una medida aprobada. |
| §4.2 Ficha oficial y autenticidad | Implementado para el flujo actual | Verificación server-side asociada a dominio, certificación e informe vigente; la ficha muestra resultados publicados. El contrato y las pruebas no garantizan impedir copiar una imagen, como reconoce el requisito. |
| §5 Ciclo periódico | Implementado con cadencia aproximada | El scheduler consulta cada cinco minutos y encola revisiones elegibles desde 40 minutos para renovar informes cuya vigencia es de 60. La prueba de una transición real de vencimiento debe revisarse con evidencia operativa, no solo local. |
| §5 Trazabilidad y gobierno del estándar | Parcial / pendiente | Cada informe conserva versiones de perfil y política; el endpoint de historial enumera informes, no cambios del estándar. Falta historial público «qué/cuándo/por qué» y el flujo humano de revisión/aprobación. |
| §5 Correos y gobierno humano | Pendiente | Los avisos operativos actuales son logs JSON; no sustituyen el correo requerido ante eventos de investigación/fallo de certificación ni la aprobación humana previa a publicar cambios. |

1. **Avisos internos por correo:** los requisitos de las secciones 2.3 y 5
   exigen avisos por correo para tecnologías desconocidas y determinados
   fallos de certificación. El código operativo observado emite eventos JSON
   en logs de schedulers; no se encontró un transporte de correo para esos
   casos. Antes de implementar siguen pendientes destinatarios, contenido
   seguro y reglas de agrupación/deduplicación (sección 6).
2. **Gobierno e historial del estándar:** el requisito exige revisión y
   aprobación humana antes de publicar cambios y un historial público que
   explique qué cambió, cuándo y por qué. No se encontró una capacidad de
   propuesta/aprobación/publicación ni un historial público del estándar. El
   flujo, roles, versión y representación de cambios siguen pendientes según
   sección 6.
3. **Alcance y aceptación de las auditorías:** la sección 6 deja pendientes el
   inventario priorizado de tecnologías, fuentes y vigencia de evidencia,
   requisitos definitivos por categoría, reglas de certificación, cadencia,
   fallos/reintentos, límites, divulgación/retención y pruebas de aceptación.
   La implementación actual cubre perfiles versionados y Solistos v1, pero no
   equivale por sí sola a haber decidido y acreditado todo ese catálogo MVP.
4. **Cobertura inicial de la base de conocimiento:** el catálogo dinámico
   `privacy-knowledge-v1` contiene cuatro reglas, todas de Google Analytics.
   El snapshot local OCKD tiene 1.255 patrones, pero el código lo usa en el
   análisis pasivo legado para el conteo agregado `catalogMatchCount`; no como
   atribución de proveedores en el análisis dinámico Solistos. No hay reglas
   dinámicas de CMP ni de otros proveedores. La especificación permite un
   catálogo incremental, pero la sección 6 deja pendiente el inventario MVP;
   por eso todavía no hay un criterio aprobado para declarar suficiente esta
   cobertura.

## Secuencia de cierre propuesta

Las tareas siguientes deben mantenerse pequeñas y separadas. La primera
pregunta de producto se formula una por turno cuando el desarrollador esté
disponible; no se comienza la implementación de cada área hasta concretar sus
criterios en una especificación de `agentic-guidelines/`.

1. **Fijar cobertura mínima del catálogo:** elegir el conjunto MVP de
   proveedores/CMP y señales, prioridad, fuentes, confianza, vigencia y
   evidencia aceptable. Separar esta tarea de ampliar el catálogo.
2. **Especificar notificaciones:** eventos, destinatarios, agrupación,
   deduplicación, contenido mínimo/redactado, persistencia, reintentos y manejo
   de fallos. Decidir qué eventos existentes migran desde logs.
3. **Especificar gobierno del estándar:** roles humanos, estados de propuesta,
   aprobación, publicación, versionado y formato del historial público.
4. **Cerrar criterios operativos y de datos:** cadencia, reintentos,
   protección de infraestructura, urgencias, retención y qué evidencia es
   pública o privada; comprobar qué partes ya tienen contrato vigente para no
   duplicarlas.
5. **Crear la matriz de aceptación del MVP** a partir de decisiones aprobadas,
   enlazando cada criterio a prueba automatizada, evidencia de producción o
   procedimiento manual reproducible.
6. **Ejecutar las puertas de entrega:** calidad, PostgreSQL, E2E, Lighthouse,
   auditoría de dependencias, SonarQube local y CI remoto; corregir fallos del
   repo. Solo entonces, siguiendo el workflow autorizado, desplegar Desarrollo
   Seguro y comprobar el estado publicado. El despliegue no sustituye la
   evidencia de requisitos funcionales.

## Pendientes operativos de esta auditoría

- La auditoría npm local no respondió en dos intentos; su gate sí pasó en los
  workflows `45069450845` y `45069829676`, así que no bloquea la evidencia de
  entrega.
- La auditoría empezó desde `fix/allow-self-domain-processor-evidence`, con
  `HEAD` en `9c0e2de` y `origin/main` en `e94d57f`; `git diff origin/main HEAD`
  no mostraba diferencias de contenido tras el squash merge del cambio de
  procesadores. No se reescribió ninguna rama.
