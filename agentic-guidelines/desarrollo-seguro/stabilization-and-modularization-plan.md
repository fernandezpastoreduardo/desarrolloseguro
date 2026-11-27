# Plan propuesto de estabilización y modularización

Fecha: 27-11-2026. Base inspeccionada: `2e1555929b77af0eb160027cc0a609b2b8d727f0`.
Estado: aprobada para ejecutar P0 y P1. P0 completada; P1 en curso. Se adelantaron
correcciones verificables de P2 autorizadas por el objetivo de estabilización. No se
cambiaron criterios de informe ni se desplegó.

## Objetivo y límites

Recuperar un desarrollo controlado, comprensible y extensible. La auditoría pública
debe funcionar para URLs HTTPS arbitrarias admitidas por la política de seguridad;
la certificación debe admitir clientes mediante configuración e identidad verificadas.
No se sustituye una comprobación fallida por una etiqueta favorable, ni se reduce
la cobertura para conseguir puntuaciones o pipelines verdes.

Durante la estabilización se propone suspender nuevas features y despliegues de
producto hasta aprobar y superar la puerta correspondiente. Continúan el diagnóstico,
las pruebas aisladas y las correcciones acordadas. No se modifica otro proyecto.
Cada paquete de abajo se ejecuta como tareas pequeñas con revisión independiente.

Se conserva la filosofía de incumplimientos legales acreditados, su evidencia,
preceptos, autoridad y consecuencias económicas. Un error del auditor no acredita
cumplimiento del sitio ni borra un incumplimiento ya demostrado. Cambiar criterios,
pesos, conclusiones o información del informe requiere aprobación explícita previa.

## Diagnóstico comprobado

| Evidencia | Consecuencia |
| --- | --- |
| `web/src/public-scan-portal/public-scan-portal.tsx`: 3.703 líneas; HTTP, polling, validadores, presentación y conclusiones | Varias responsabilidades cambian juntas; política duplicada en UI |
| `loadTargetStatus` borra autorización; autoenvío usa una excepción; retry no la usa (`:613,637,692,835,1007`) | El reintento puede terminar sin enviar ninguna solicitud |
| El test de error comprueba visibilidad, no clic y recuperación; retry carece del selector de estilo del formulario | El bug atraviesa la batería actual |
| `worker/src/privacy-browser-observer.ts:231-299`: presupuesto global y catch que devuelve todas las fases desconocidas | Un error tardío puede borrar evidencia anterior válida |
| `worker/src/privacy-public-browser-evidence.ts:57`: publica métricas solo con perfil completo | Se pierden medidas parciales válidas antes de llegar a la UI |
| `core/src/scan-ingestion-policy.ts:489-525`: normaliza DS-QUAL-02 sin conservar diagnóstico de rendimiento | La causa termina como «Comprobación DS-QUAL-02: unknown.» |
| Hardcodes de Grumphya en contratos/auth/reader/worker/API/SQL; DesarrolloSeguro usa registro especial | Autoauditoría y nuevos clientes no siguen un mecanismo común |
| Playwright usa Vite dev y API interceptada; smoke productivo solo admite dos dominios | Las puertas no demuestran el recorrido completo de un dominio nuevo |
| Hooks presentes pero sin `core.hooksPath` configurado aquí; pre-push solo comprueba migraciones | No puede afirmarse que precommit/push ejerzan todas las garantías |
| Sonar local configurado, artefacto anterior al release; puerto 9000 inaccesible durante revisión | No existe baseline actual comprobada de hallazgos Sonar |

La consulta de solo lectura al informe vigente de referencia conservaba inventarios
inicial/aceptación/rechazo completos de dos cookies catalogadas, con criterios de
Privacidad desconocidos. Rendimiento registraba errores de adquisición en ambos
perfiles. Esto prueba discrepancias entre capas, no determina por sí solo la causa
de cada fallo de Chromium. No se conocen las ejecuciones fallidas de las dos webs
nuevas: no se inventa su causa ni se condiciona el plan a conocer esos dominios.

## Arquitectura objetivo propuesta

Conservar inicialmente monorepo y procesos existentes. No añadir microservicios,
frameworks ni dependencias para realizar la separación.

1. **Contratos**: esquemas de entrada/salida versionados, estados, evidencia,
   diagnósticos y compatibilidad. Una única definición canónica por contrato;
   las restricciones SQL se validan contra el mismo corpus que TypeScript.
2. **Dominio puro**: reglas jurídicas, criterios, rúbricas, aplicabilidad y
   puntuación; no HTTP, SQL, React ni nombres de clientes.
3. **Casos de uso**: solicitar, ejecutar, renovar, reintentar, publicar y revocar.
   Coordinan interfaces pequeñas; no interpretan HTML ni producen textos de UI.
4. **Adaptadores**: navegador, red segura, catálogo, evidencia certificada y
   PostgreSQL. Conservan resultados independientes y causas acotadas por fase.
5. **Presentación**: cliente HTTP, controlador del ciclo de informe, presentadores
   y módulos Legalidad/Privacidad/Seguridad/Rendimiento, más componentes compartidos.
   El ensamblador compone categorías; no reevalúa consentimiento ni puntuación.

Cada aspecto debe conservar cobertura, evidencia, conclusión y diagnóstico técnico.
La ejecución distingue pendiente, ejecutando y terminada; terminar no implica
haber adquirido todos los datos. El contrato final de estados se aprueba en P3.
La ausencia de banner no demuestra exención de consentimiento. «Seguro · sin
cookies no técnicas» debe proceder del evaluador y evidencia suficiente, también
cuando existan cookies técnicas verificadas; cero coincidencias de catálogo no basta.

## Secuencia y puertas de salida

### P0. Inventario y baseline reproducible

- Mapear capacidades, entrypoints, scripts, hooks efectivos, jobs, imágenes, roles,
  migraciones, contratos y flujos reales. Registrar SHA y entorno por resultado.
- Recuperar Sonar local existente sin borrar volúmenes; obtener análisis actual y
  exportar issues, hotspots, complejidad, duplicación, cobertura, reglas y exclusiones.
- Registrar incidentes por request/job/run y release, con evidencia saneada y etapa;
  no almacenar tokens, valores de cookies ni query sensible en logs.
- Construir matriz requisito → riesgo → prueba ejecutada → artefacto. Explicitar
  qué puertas no prueban integración real.

Salida: inventario auditable, backlog de hallazgos con severidad/causa, baseline
Sonar actual o bloqueo técnico explícito; ninguna cifra histórica presentada como actual.

### P1. Laboratorio integral y reproducciones que fallen

- Ejecutar artefactos y migraciones de producción con API, cola, worker, runtime,
  proxy y PostgreSQL reales; conservar mocks solo en tests de unidades concretas.
- Laboratorio local controlado, sin dependencia de webs externas. Resolver hostnames
  sintéticos distintos por ejecución mediante infraestructura de pruebas aislada;
  no habilitar acceso privado ni desactivar SSRF en código de producción.
- Recorrido navegador → solicitud → ejecución → informe → UI con URL nunca vista,
  ruta/query, polling y recuperación. Dos URLs del mismo host no se confunden.
- El test de retry debe pulsar, comprobar nueva solicitud, admisión y resultado sin
  recargar. Cubrir teclado, foco y estilo en móvil/escritorio y claro/oscuro.
- Inyectar errores en adquisición, IPC, evaluación, SQL, lectura y presentación.

Diseño de laboratorio recomendado: proyecto Docker desechable con DB/volumen,
certificado CA y hostname sintético únicos; fixture HTTPS solo en una red interna
sin ruta externa. Mantener API, cola, worker, coordinador, ejecutor, observador,
persistencia y UI reales. En las fronteras de salida usar adaptadores exclusivos de
prueba que conectan el hostname exacto al fixture y preservan Host/SNI/query. No
añadir modo de resolución permisivo ni allowlist de test a configuración de
producción. En el mismo corpus, verificar por separado que el adaptador de producción
rechaza loopback/RFC1918/link-local antes de abrir la conexión. No usar el Compose
productivo, sus redes, volúmenes o secretos como stack del laboratorio. El coordinador
del laboratorio necesitará montar el socket Docker local para crear los ejecutores.
El socket concede acceso amplio al daemon; por ello el test solo usará fixtures
controlados y nombres/volúmenes/redes únicos, y validará que cleanup afecte únicamente
a recursos etiquetados con el identificador de esa corrida.

Descomposición ejecutable de P1:

1. **LAB-01 · composición efímera**: servicios, nombres, redes, secretos y datos
   únicos por corrida; PostgreSQL vacío con migraciones reales; salida de UI solo en
   loopback; etiquetas de recursos para verificar cleanup. No parar ni reutilizar
   contenedores, redes o volúmenes preexistentes.
2. **LAB-02 · fixture HTTPS**: servidor local sin egreso, certificado con SAN para
   `scan-<run-id>.example.net` (no reservar `.test` ni `.example`); respuestas
   parametrizadas por path: página normal, consentimiento con cookies conocidas y
   timeout/recurso parcial. La query inocua se conserva de extremo a extremo.
3. **LAB-03 · adaptadores egress solo de prueba**: variantes de broker y proxy que
   invocan las implementaciones de scanner reales con resolver/conexión inyectados,
   limitados al FQDN efímero y fixture. Preservar Host/SNI/query; red `internal` sin
   salida externa. Las imágenes de producción y su configuración no reciben flags
   permisivos ni allowlists adicionales.
4. **LAB-04 · recorrido real**: navegador contra web construida; API, cola, worker,
   coordinador IPC, ejecución aislada, persistencia e informe reales. Sin interceptar
   las rutas API. Comprobar informe terminal visible, evidencia por perfil, retry
   posterior a error, nueva admisión y resultado sin recargar.
5. **LAB-05 · seguridad y limpieza**: solicitudes negativas de SSRF, intento de
   recurso externo bloqueado, DNS público/privado mezclado y egress efectivo; cerrar
   solo recursos con la etiqueta de la corrida. Comprobar que los contenedores,
   redes y volúmenes previos conservan su estado.

El coordinador de laboratorio requiere acceso al daemon Docker para crear trabajos
aislados. Su uso se limita a pruebas con fixture controlado y recursos de la corrida;
no se apunta a servicios productivos ni a dominios de terceros. La composición
productiva no se inicia ni se usa para estos tests.

Salida: reproducciones fallan por los bugs actuales y pasan únicamente al corregirlos;
el recorrido no depende de nombres ni resultados esperados de clientes conocidos.

### P2. Correcciones del recorrido y preservación de evidencia

Tareas independientes: (a) retry y autorización coherentes; (b) resultados por fase
de Privacidad con aislamiento de excepciones; (c) conservar métricas parciales;
(d) diagnósticos a través de ingesta/SQL/API; (e) progreso y terminación coherentes.

- Mantener presupuesto total y cuotas por fase sin aumentar límites a ciegas.
  Probar timeout, cancelación y cierre de contenedores/contextos.
- Alinear cada criterio con la evidencia necesaria: un problema de almacenamiento
  no oculta inventario de cookies; un fallo de proveedores no borra rechazo;
  móvil fallido no borra escritorio. No fabricar notas con requisitos ausentes.
- Definir deadline/lease, recuperación tras reinicio y finalización de trabajos
  huérfanos para que nunca queden spinners indefinidos ni duplicación de trabajo.
- Diagnóstico trazable por release/request/job/run/aspecto/fase, duración,
  presupuesto consumido, causa y reintento permitido. Retención y cardinalidad acotadas.

Salida: corpus completo y parcial conserva valores entre todas las fronteras;
errores terminales explicados, retry efectivo y evidencia jurídica preservada.
Primer release de recuperación elegible solo al superar P1/P2 y las verificaciones
previas y recuperación de P7. La preparación de entrega segura se trabaja desde P0,
sin esperar al final del refactor.

### P3. Contratos y políticas como fuente única

- Separar versión de esquema, scanner y política. Compatibilidad explícita.
- Corpus de escritura/lectura real con roles API/worker restringidos y permisos de
  producción. Probar payload completo, parcial, ausente, inválido e histórico requerido.
- Mover conclusiones inferidas por UI al evaluador; presentar consentimiento no
  requerido, desconocido y rechazo comprobado con razones distintas.
- Revisar `fail` técnico frente a incumplimiento jurídico acreditado: el diseño no
  debe afirmar ilegalidad por un timeout o por un umbral técnico de rendimiento.

Salida: añadir una métrica no exige mantener listas divergentes sin comprobación;
un payload válido no se rechaza por un scanner compatible; política y UI concuerdan.
Los cambios semánticos de evaluación se presentan al usuario antes de implementarse.

### P4. Refactor vertical y limpieza demostrada

- Separar primero controlador HTTP/polling/retry y contrato del portal; después
  cada categoría con su presentador. Revisar una extracción por vez.
- Dividir persistencia en repositorios de trabajos, informes, certificación y
  catálogo; separar orquestación de adquisición y evaluación.
- Mantener interfaces por responsabilidad. El número de líneas ayuda a detectar
  concentración; no se usa un límite arbitrario como definición de SOLID.
- Inventariar imports, exports, scripts, entrypoints Docker, rutas, HTML y assets,
  consumidores externos y lectores históricos antes de borrar código.
- Clasificar tests por comportamiento/riesgo: conservar, reescribir, duplicado,
  huérfano o reemplazado. Un test no ejecutado es primero una brecha de conexión;
  baja cobertura no demuestra código muerto. Revisar pruebas que solo inspeccionan
  texto fuente, conservando controles arquitectónicos de seguridad deliberados.
- Borrar implementación sustituida, fixtures inútiles y docs obsoletas en el mismo
  lote verificado. No mantener dos motores definitivos para una responsabilidad.

Salida: cambios de una categoría no requieren editar otras; todo borrado tiene
evidencia de uso y sustitución; contratos y recorridos mantienen sus resultados.

### P5. Clientes configurables y autoauditoría real

- Diseñar registro de cliente/capacidades: dominio y alias autorizados, endpoints,
  scopes, issuer/audience, claves, revocación, frescura y presupuestos.
- Entregar primero prompt contractual autónomo para otros repositorios: rutas,
  payloads/estados, firmas, scopes, límites, permisos y pruebas. Decidir el transporte
  y compatibilidad antes de escribir adaptador o gateway; no elegir push/pull implícitamente.
- Sustituir decisiones por hostname en contratos, SQL, worker, API y UI por
  identidades y capacidades verificadas. No convertir las allowlists de seguridad
  en acceso universal; configurar autorización explícita por cliente.
- Cliente sintético con identidad nueva se incorpora sin editar evaluadores,
  validadores, frontend ni migraciones por hostname. Probar aislamiento entre clientes.
- DesarrolloSeguro se enrola y entrega evidencia por el mismo contrato que los
  demás; el registro especial actual no demuestra autoauditoría equivalente.

Salida: alta de cliente solo por mecanismo/configuración documentados; autoauditoría
con evidencia propia verificable. No se cambia ni despliega Grumphya en esta tarea.

### P6. Sonar y deuda restante hasta cierre

Sonar se repite durante P2–P5, no se aplaza todo a esta fase. Ordenar vulnerabilidades,
bugs, hotspots revisados, complejidad, duplicación y mantenibilidad. Corregir por
responsabilidad; no aplicar cambios automáticos masivos ni añadir exclusiones,
supresiones o cambiar el periodo de código nuevo para conseguir verde.

Salida: todos los hallazgos de la baseline y posteriores corregidos o, únicamente
si corresponde, falsos positivos/no aplicables justificados con evidencia revisable;
sin deuda aceptada silenciosamente. Hotspots revisados, gate aprobado, alcance del
análisis documentado. Scripts/infra/páginas fuera de Sonar se cubren con los análisis
compatibles existentes; Sonar no se presenta como prueba de corrección funcional.

### P7. Entrega y promoción controladas

- Entorno reproducible y bootstrap que comprueba versiones/herramientas/hook real;
  documentar qué significan dotese/decopu y mapearlos a comandos versionados.
- Gates locales y remotos comparten comandos; el remoto no depende de hooks locales.
- Construir una vez por SHA y promover exactamente los digests probados. Resolver
  carga/transporte/registro de imágenes con requisitos de dependencia y privacidad.
- Prueba previa al tráfico con roles, migraciones y runtime reales; compatibilidad
  de esquema y rollback comprobados. Retener artefacto anterior y datos.
- Smoke posterior con navegador sobre el artefacto servido; fallo detiene promoción
  o revierte cuando sea compatible. Live externos como supervisión complementaria,
  con fallos de terceros identificados, no dependencia única de entrega.

Salida: registro de release con SHA/digests, suites, Sonar, Lighthouse, despliegue,
smoke y rollback. Un fallo identifica su etapa sin reconstrucción forense inicial.

## Matriz mínima de pruebas

Escenarios con hostnames variables, sin condiciones por nombre:

| Grupo | Comportamientos |
| --- | --- |
| Solicitud | URL nueva, informe vigente/caducado, dos rutas/query, concurrencia, rate limit, retry, recarga y cancelación |
| Cookies | Cero, solo técnicas verificadas, desconocidas, seguimiento inicial, rechazo eficaz/ineficaz, aceptación, recarga, proveedor inactivo/activo |
| Privacidad parcial | Cookies completas con storage incompleto, fallo tardío, política inaccesible, proveedor lento, presupuestos agotados |
| Rendimiento | Ambos perfiles completos, falta una métrica, perfil caído, recurso externo lento/bloqueado, HTML pesado, error Chromium |
| Transporte | HTTPS, redirecciones autorizadas, alias, DNS/TLS/HTTP fallidos, SSRF/rebinding, credenciales y redirección a destino privado rechazadas |
| Persistencia | Roles reales, ida/vuelta, migración limpia y desde versión anterior, histórico requerido, caída/reanudación, idempotencia |
| Cliente | Identidad nueva, scopes, firma, expiración/replay, revocación, capacidad ausente, aislamiento y autoauditoría |
| Interfaz | Cargado/vacío/error/parcial, cookies y métricas visibles, retry real, foco/teclado, móvil/escritorio, ambos temas |

Unitarias para políticas puras; contratos para fronteras; integración para SQL/runtime;
E2E reales para recorridos críticos. Evitar repetir toda la matriz en cada nivel.
Umbrales de cobertura se fijan tras baseline por módulos críticos y ramas; no se
confunde porcentaje con calidad. Lighthouse mantiene >=96 en Rendimiento,
Accesibilidad y Buenas prácticas para ambos perfiles; SEO según excepción vigente.
Probar estados de informe además de entrada vacía, guardando resultados por SHA.

## Aprobación y ejecución

Esta propuesta no es un único goal de reescritura. La aprobación recibida autoriza
ejecutar P0 y P1; cada paquete mantiene entregables, revisión y criterios de salida.
Los contratos de P3/P5 y cualquier cambio de semántica del informe se someten a la
decisión del usuario. No se promete ausencia absoluta de regresiones: el cierre
exige evidencia repetible de los comportamientos acordados y una recuperación
verificada ante fallo.

## Registro de ejecución

### P0 · completada · SHA `2e1555929b77af0eb160027cc0a609b2b8d727f0`

- Escaneo local de SonarQube completado el 27-11-2026 a las 21:25, hora de Madrid;
  servidor `26.10.0.133078`, estado `UP`.
- Quality Gate aprobado: 80,5 % de cobertura nueva, 1,64 % de duplicación nueva y
  cero infracciones nuevas. Consulta: cero issues y cero hotspots pendientes de
  revisión. Medidas del proyecto: 80,8 % de cobertura y 2,4 % de duplicación.
- Suite de cobertura: 1.422 pruebas ejecutadas y 191 omitidas; 190 omitidas son de
  persistencia. El gate no sustituye la integración PostgreSQL.
- El análisis indexó 372 archivos y solo cubre `apps/desarrollo-seguro`; no cubre
  scripts de raíz, CI, Docker ni documentación. No se presenta el cero de issues
  como auditoría completa del repositorio.
- Hooks: Git no tiene `core.hooksPath` configurado en este checkout. Aunque existe
  `.husky/pre-commit`, no se activa aquí; `.husky/pre-push` solo revisa migraciones.
- Matriz de alcance y gaps: CI tiene smoke de componentes, pero Playwright intercepta
  la API y el smoke público contempla solo los dos casos configurados. No hay aún
  recorrido integral de un hostname nuevo hasta el informe visible.

### P1 · en curso

- Reproducción aislada del retry en navegador con hostname sintético y API simulada:
  envío inicial `1`; tras pulsar «Volver a solicitar análisis», envíos `1`. El botón
  no tiene clase y muestra estilos predeterminados del navegador. Esto demuestra que
  el click no vuelve a solicitar y que el E2E existente no lo detecta; no atribuye
  por sí solo el fallo de las dos webs externas.
- El recorrido de laboratorio API → cola → worker → runtime → PostgreSQL → navegador
  sigue pendiente. El Compose de producción no es reutilizable como laboratorio:
  depende de secretos/redes externas y monta el socket Docker en el coordinador. El
  Sonar local está activo; el contenedor de integración PostgreSQL preexistente está
  detenido. No se iniciaron ni detuvieron contenedores durante este diagnóstico.
- P1 reutilizará las interfaces inyectables existentes en
  `transport-v1-network-observer.ts` y `privacy-egress-proxy.ts`, con adaptadores de prueba en fronteras
  aisladas. Aún falta definir e implementar la composición desechable; no se ha
  debilitado SSRF ni alterado la configuración productiva.
- Reproducción pendiente de Privacidad y Rendimiento en frontera de adquisición,
  ingesta, persistencia y presentación, con carga parcial y completa.
- No se instalaron dependencias ni se modificó código de producto durante P0/P1.

### P2 · correcciones adelantadas · verificación local

- (a) Retry: conserva autorización solo para el mismo hostname y URL; el botón
  vuelve a enviar la solicitud, recibe admisión y muestra progreso sin recargar.
  E2E comprueba segundo POST, estado en progreso, desaparición del botón y CSS.
- (b) Privacidad: cada fase captura su propio fallo; una fase tardía falla sin
  descartar inventarios previos. El estado global pasa a parcial si falla una visita
  de política encontrada. Tests comprueban conservación y que valores de cookies no
  se persisten.
- (c/d) Rendimiento: métricas numéricas disponibles y diagnósticos por perfil se
  conservan en perfiles parciales y sobreviven la normalización de ingesta.
- Verificaciones locales: `ci:verify quality` aprobado; E2E 6/6; Lighthouse mobile
  y desktop 100 en Rendimiento, Accesibilidad y Buenas prácticas (SEO 60 informativo);
  PostgreSQL 195 tests de persistencia y 1 de worker aprobados; análisis Sonar Quality
  Gate aprobado. Repetir Sonar después del commit para eliminar la advertencia SCM
  sobre cambios sin blame en el árbol de trabajo.
- P2 no está completo: progreso/estados terminales y recuperación de leases siguen
  pendientes. El laboratorio P1 completo sigue siendo la puerta para llamar verificado
  al recorrido API → worker → navegador. No desplegar antes de completarlo y pasar
  CI remoto e imágenes.
