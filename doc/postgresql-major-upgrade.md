# Migración PostgreSQL 17 a 19

## Estado

El clúster de producción de Desarrollo Seguro continúa en PostgreSQL 17.11, imagen pgvector 0.8.7, volumen `development-security-postgres`. Grumphya usa otra base, otro contenedor y otro volumen. No comparten esquema ni datos. El cambio de Grumphya no puede montar ni convertir el volumen de Desarrollo Seguro.

El objetivo preparado es PostgreSQL 19 con la imagen propia `desarrolloseguro-postgres:pg19-candidate`, construida desde `pgvector/pgvector:0.8.7-pg19-trixie`, y Node.js 26.13.1. La imagen actualiza los paquetes Debian disponibles y recompila `gosu` con una versión corregida de Go. La extensión `vector` no está habilitada en la base de producción actual; el ensayo sintético sí la crea para verificar que la extensión e índices sobreviven una restauración lógica.

CI usa PostgreSQL 19 para las pruebas de persistencia, analiza con Trivy la imagen candidata que se usaría en producción y ensaya la restauración de roles, bases, privilegios y datos desde un clúster PG17 en volúmenes efímeros. El informe completo de vulnerabilidades queda como artefacto; la puerta bloquea los hallazgos altos/críticos con corrección publicada (`--ignore-unfixed`) para evitar declarar mitigadas vulnerabilidades que Debian todavía no ha corregido. El Compose preparado apunta a la imagen PG19 propia y al volumen versionado `development-security-postgres-pg19`; el VPS activo continúa en PG17 hasta que ese volumen se restaure y valide. El despliegue de la aplicación construye la imagen de base de datos, pero no cambia ni inicia el volumen de producción por sí solo.

## Requisitos para el corte del VPS

1. Confirmar que no hay un análisis o despliegue de Desarrollo Seguro en curso y coordinar una única ventana de mantenimiento.
2. Crear backup cifrado fuera del VPS de las bases de Grumphya y Desarrollo Seguro. Restaurar ambas copias en entornos aislados y verificar que son legibles antes de fijar la ventana de mantenimiento. En el dump de clúster de Desarrollo Seguro, eliminar únicamente la cláusula `GRANTED BY ds_bootstrap` al restaurar sobre el PG19 inicializado con el rol superusuario `ds_bootstrap`: PostgreSQL 19 rechaza esa atribución explícita porque el rol no conserva `ADMIN OPTION` sobre `ds_read`. Al ejecutar el `GRANT` con la sesión ya autenticada como el mismo superusuario destino, se conservan el grantor efectivo y la membresía; el ensayo sintético verifica ambos. Excluir del dump las sentencias `CREATE ROLE` y `ALTER ROLE` de `ds_bootstrap`, ya que el destino ya lo crea durante su inicialización con la contraseña configurada en Secret.
3. Revisar bytes disponibles y duración medida de una restauración completa. El ensayo sintético no representa el volumen ni la latencia de la base real.
4. Detener los procesos escritores de ambos servicios, crear la copia final y restaurar todo el clúster de Desarrollo Seguro (roles y bases conectables) en un volumen PG19 nuevo. En el SQL de `pg_dumpall`, filtrar las líneas `CREATE ROLE ds_bootstrap` y `ALTER ROLE ds_bootstrap`, y quitar `GRANTED BY ds_bootstrap`; restaurarlo como `ds_bootstrap` desde `postgres`. Restaurar Grumphya en su propio volumen PG19 mediante su helper de backup/restauración, incluyendo pgvector y sus índices.
5. Verificar versiones, inventario de roles y bases, migraciones, permisos, filas por tabla, secuencias e índices sin imprimir contenido de informes ni dominios en logs.
6. Iniciar Desarrollo Seguro sobre el volumen nuevo, validar TLS, health, consultas y el sello de Grumphya. Iniciar Grumphya sobre su volumen propio y validar health, sello, evaluación y roast.
7. Mantener los volúmenes PG17 detenidos e intactos. Antes de reabrir escrituras, cualquier fallo permite volver a PG17. Después de admitir escrituras en PG19, el volumen PG17 queda obsoleto y no se debe volver a él sin una reconciliación explícita.
8. Conservar los backups restaurados y ambos volúmenes PG17 durante la ventana de observación. Eliminar una copia antigua solo mediante la política de retención aprobada, nunca con `docker compose down -v`.

El cambio del sello ya terminó y no hay un despliegue activo. El corte sigue condicionado a que los backups cifrados reales se restauren y validen, y a completar los chequeos de espacio, duración y aplicación en ambos servicios. CI verifica datos sintéticos y no sustituye esas comprobaciones.
