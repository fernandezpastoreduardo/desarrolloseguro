# Migración PostgreSQL 17 a 19

## Estado

El clúster de producción de Desarrollo Seguro continúa en PostgreSQL 17.11, imagen pgvector 0.8.7, volumen `development-security-postgres`. Grumphya usa otra base, otro contenedor y otro volumen. No comparten esquema ni datos. El cambio de Grumphya no puede montar ni convertir el volumen de Desarrollo Seguro.

El objetivo preparado es PostgreSQL 19 con la imagen propia `desarrolloseguro-postgres:pg19-candidate`, construida desde `pgvector/pgvector:0.8.7-pg19-trixie`, y Node.js 26.13.1. La imagen actualiza los paquetes Debian disponibles y recompila `gosu` con una versión corregida de Go. La extensión `vector` no está habilitada en la base de producción actual; el ensayo sintético sí la crea para verificar que la extensión e índices sobreviven una restauración lógica.

CI usa PostgreSQL 19 para las pruebas de persistencia, analiza con Trivy la imagen candidata que se usaría en producción y ensaya la restauración de roles, bases, privilegios y datos desde un clúster PG17 en volúmenes efímeros. El informe completo de vulnerabilidades queda como artefacto; la puerta bloquea los hallazgos altos/críticos con corrección publicada (`--ignore-unfixed`) para evitar declarar mitigadas vulnerabilidades que Debian todavía no ha corregido. La configuración de producción mantiene PG17 como valor por defecto. Los parámetros de volumen permiten un corte versionado futuro sin reutilizar la ruta anterior.

## Requisitos para el corte del VPS

1. Esperar a que Desarrollo Seguro concluya la investigación del sello de certificación en el footer de Grumphya; no reiniciar API, worker, schedulers, analizador ni PostgreSQL mientras siga activa.
2. Crear backup cifrado fuera del VPS de las bases de Grumphya y Desarrollo Seguro. Restaurar ambas copias en entornos aislados y verificar que son legibles antes de fijar la ventana de mantenimiento.
3. Revisar bytes disponibles y duración medida de una restauración completa. El ensayo sintético no representa el volumen ni la latencia de la base real.
4. Detener los procesos escritores de ambos servicios, crear la copia final y restaurar todo el clúster de Desarrollo Seguro (roles y bases conectables) en un volumen PG19 nuevo. Restaurar Grumphya en su propio volumen PG19, incluyendo pgvector y sus índices.
5. Verificar versiones, inventario de roles y bases, migraciones, permisos, filas por tabla, secuencias e índices sin imprimir contenido de informes ni dominios en logs.
6. Iniciar Desarrollo Seguro sobre el volumen nuevo, validar TLS, health, consultas y el sello de Grumphya. Iniciar Grumphya sobre su volumen propio y validar health, sello, evaluación y roast.
7. Mantener los volúmenes PG17 detenidos e intactos. Antes de reabrir escrituras, cualquier fallo permite volver a PG17. Después de admitir escrituras en PG19, el volumen PG17 queda obsoleto y no se debe volver a él sin una reconciliación explícita.
8. Conservar los backups restaurados y ambos volúmenes PG17 durante la ventana de observación. Eliminar una copia antigua solo mediante la política de retención aprobada, nunca con `docker compose down -v`.

Este runbook todavía no autoriza un deploy de PG19. Hace falta ejecutar y revisar el backup/restauración real, comprobar espacio y duración, acabar la investigación del sello, y coordinar un único corte de mantenimiento entre los dos repositorios. CI verifica compatibilidad de datos sintéticos y no sustituye esas comprobaciones.
