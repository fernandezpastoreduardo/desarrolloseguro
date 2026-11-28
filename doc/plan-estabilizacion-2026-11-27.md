# Propuesta de estabilización del proyecto

Actualizado el 28 de noviembre de 2026. P0 y P1, y los fixes de bugs P2 acordados,
están completados localmente. LAB-01 y LAB-04 pasaron con imágenes construidas del
árbol actual. La recuperación general de jobs/leases huérfanos queda diferida.
Estado e informe se correlacionan por UUID de job, sin guardar URL o hash en la fila
del job tras finalizar; los informes persisten la ruta y query auditadas conforme al
alcance aprobado. Falta verificar el commit en CI remoto antes de decidir si procede
el despliegue.

La revisión encontró causas verificables para varios defectos: el reintento puede
salir sin enviar una solicitud; fallos tardíos pueden borrar evidencia de cookies;
los perfiles incompletos pierden métricas válidas y su diagnóstico se reemplaza
durante la ingesta. También confirmó que la integración de clientes depende de
nombres concretos en varias capas y que los E2E actuales sustituyen la API.

Por eso un workflow verde no acredita todavía el recorrido de un usuario que
solicita una auditoría pública nueva. El último despliegue pasó sus comprobaciones,
pero estas no ejercían todos los comportamientos que el producto promete.

## Orden propuesto

| Paquete | Resultado que debe entregar |
| --- | --- |
| P0 · Baseline | Completada: gates, hooks, cobertura, Sonar local y laboratorio definidos |
| P1 · Laboratorio real | Completada localmente: LAB-01 y LAB-04 pasaron con artefactos recién construidos de este árbol; falta el resultado del workflow remoto para cerrar la entrega |
| P2 · Recuperación | Fixes acordados completados: retry, progreso, evidencia/métricas parciales y error ligado al job. La recuperación general de jobs/leases huérfanos queda diferida |
| P3 · Contratos | Esquemas canónicos y políticas fuera de React; validación de escritura/lectura y compatibilidad |
| P4 · Módulos y limpieza | Categorías independientes, repositorios pequeños y retirada demostrada de código/tests sustituidos |
| P5 · Clientes | Alta por identidad y capacidades; DesarrolloSeguro auditado con el mismo contrato que otros clientes |
| P6 · Sonar y deuda | Hallazgos corregidos y hotspots revisados; sin exclusiones para fabricar un gate verde |
| P7 · Entrega | Artefacto probado igual al promovido, comprobación previa al tráfico y rollback verificado |

Sonar y la preparación de la entrega segura empiezan en P0 y acompañan los demás
paquetes. El primer despliegue de recuperación requiere laboratorio y correcciones
verificados, más comprobación previa y procedimiento de recuperación. No hace falta
esperar a terminar todo el refactor para recuperar el servicio.

Se propone pausar nuevas features mientras se estabiliza el recorrido. Cada paquete
se divide en tareas pequeñas; este documento no autoriza una reescritura de una vez.
Los cambios de criterios, notas o significado del informe necesitan aprobación
expresa previa. Se mantiene la filosofía de infracciones legales demostradas.

## Qué cambia en las pruebas

Los tests se organizan por comportamiento y riesgo, no por nombres de dominios ni
por número de aserciones. El laboratorio genera hostnames diferentes y comprueba
una URL nueva, reintento, cookies en las tres fases, páginas sin cookies o con
cookies técnicas, terceros lentos, límites, redirecciones y errores de adquisición
y persistencia. La UI debe mostrar el resultado y recuperarse sin recarga.

Las unitarias cubren reglas puras; integración cubre contratos, permisos y SQL;
el navegador recorre API/worker/runtime reales sobre artefactos construidos.
Los sitios públicos pueden servir de contraste adicional, sin convertirse en
excepciones de código ni en la única puerta de entrega.

Un archivo sin cobertura no se elimina por ese motivo. Primero se comprueban sus
consumidores y su función. Un test no conectado se revisa antes de borrarlo; pueden
faltar precisamente las pruebas que deberían estar ejecutándose.

El plan técnico y los criterios de aceptación de cada paquete están en
[`stabilization-and-modularization-plan.md`](../agentic-guidelines/desarrollo-seguro/stabilization-and-modularization-plan.md).

La reproducción inicial de P1 encontró que el click en «Volver a solicitar análisis»
no enviaba una segunda solicitud. La suite de cobertura de P0 pasó 1.422 pruebas y
omitió 191, incluidas 190 de persistencia. La regresión ahora verifica el retry real.

El navegador también mostró que el E2E anterior pasa sin pulsar el retry. Se añadió
una regresión que ahora pulsa y verifica el segundo POST y la recuperación sin
recargar; pasó con el fix. Ya existe una fixture HTTPS de prueba con hostname por
corrida, SNI/Host exactos, query preservada, cookie analítica sintética, recurso
demorado y listener HTTP opcional. Los adaptadores de laboratorio limitan DNS y
conexión al hostname sintético y al servicio fixture; no alteran el scanner ni la
política SSRF de producción. Sus contratos pasan 10/10 pruebas y se incorporaron al
test del worker. Se añadió `scripts/run-development-security-public-audit-lab-01.sh`
para la composición inicial: red interna sin puertos publicados, alias
`development-security-database`, TLS desde el arranque, volumen desechable, migraciones
en modo de producción y comprobación del API mediante `docker exec`. LAB-01 pasó en
Docker local con API de producción, PostgreSQL aislado y 75 migraciones; no publicó
puertos y limpió sus recursos etiquetados. El workflow CI ejecuta este gate.
Se añadieron imágenes de laboratorio por corrida sobre las bases productivas ya
construidas: broker, proxy de privacidad y navegador con el entrypoint que acepta el
certificado autofirmado de fixture. El helper copia solo el certificado público y
configuración de prueba, y hace el smoke de SAN/entrypoint en contenedores sin red.
Se puede invocar localmente con `pnpm lab:build-images -- <run-id> <fixture.pem>
<broker-base> <privacy-egress-base> <privacy-browser-base>`. LAB-04 pasa localmente
con artefactos construidos desde este árbol: la primera ejecución falla, el retry
vuelve a solicitar y el informe aparece sin recargar. Captura todos los estados de
aceptar/rechazar antes de elegir, después de elegir y después de recargar; la fixture
muestra 1→0→1 cookies al rechazar y recargar. El aviso tiene enlace a política. El
gate exige FCP, LCP, CLS, TBT, TTFB, bytes y puntuación numérica móvil/escritorio. CI
ejecuta LAB-04 con artefactos del mismo SHA.

El gate encontró dos ejecuciones remotas que completaban el trabajo con inventarios
de privacidad y rendimiento desconocidos, aunque el mismo recorrido pasó localmente.
Se añadió al diagnóstico exclusivo del laboratorio el estado de los tres flujos del
navegador y los contadores agregados de conexiones/bytes del proxy. Ese registro no
incluye URL, contenido ni valores de cookies y permitirá localizar la frontera de
red o navegador que falla en el siguiente intento.

El laboratorio identificó luego que CI devolvía `EAI_AGAIN` al resolver el alias
Docker de la fixture. El runner ahora obtiene de Docker la IP privada de la fixture
en la red interna y la pasa solo a los contenedores de esa corrida. Las conexiones
siguen verificando certificado, SNI y cabecera Host con el hostname sintético; la
comprobación DNS de la auditoría se mantiene separada. Antes del navegador se prueba
HTTPS directo y, si falla, solo se registran fase y código de error. El recorrido
LAB-04 completo pasó localmente con este cambio, incluidos retry, cookie inicial,
aceptación, rechazo, perfiles de rendimiento y publicación del informe.

Las correcciones de P2 hacen que el retry reenvíe la solicitud autorizada de la misma
URL, que un fallo tardío de Privacidad conserve inventarios previos, que Rendimiento
retenga métricas parciales y diagnósticos, y que un fallo técnico terminal solo se
muestre para el job que lo produjo. El informe anterior permanece visible si una
actualización nueva falla. Solo el fallo terminal del job completo permite mostrar
el error genérico y reintentar; un criterio incompleto o un hallazgo sigue siendo
resultado de auditoría. El polling consulta por hostname y UUID de job;
la ruta/query se mantiene en memoria en el navegador y el informe se obtiene por
`ds_scan_runs.job_id`. Una prueba HTTP retrasa el POST de una URL, cambia a otra y
comprueba que la respuesta vieja no toma control de la vista. Una respuesta de error
del job nunca sustituye un informe ni un estado de criterios.

No se modificaron umbrales, puntuaciones ni reglas legales. Pasaron localmente
`ci:verify quality`, los 7 E2E, Lighthouse (100 en rendimiento, accesibilidad y
buenas prácticas tanto móvil como escritorio), PostgreSQL (200 pruebas de
persistencia y 1 de worker), `ci:verify audit` y el Quality Gate local de Sonar. Sonar
registra 87 issues históricos cerrados y ninguno abierto. Siguen apareciendo avisos
de rutas de cobertura LCOV sin resolver y falta de blame en archivos aún sin commit;
se revisarán tras subir el commit. La suite Postgres detectó que el nuevo polling
necesita permisos de lectura para `ds_scan_jobs.trigger` y `ds_scan_runs.job_id`; el
provisioning local y de producción ahora concede esas columnas mínimas y la prueba
como rol `ds_api` pasa.

Además, la respuesta pública ya conserva los bytes transferidos por móvil y escritorio
cuando cada perfil supera 1 MB, hasta el límite de 64 MiB que admite la ingesta. Antes,
esa proyección descartaba esas cifras y la interfaz podía ocultar puntuaciones ya
calculadas. La regresión se verificó en la proyección y en el informe de navegador;
no se cambiaron la rúbrica ni las notas.
