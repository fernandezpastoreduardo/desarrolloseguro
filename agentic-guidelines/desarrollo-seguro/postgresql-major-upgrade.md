# Actualización de PostgreSQL 17 a 19

## Alcance

Actualizar la base de datos propia de Desarrollo Seguro a PostgreSQL 19 y mantener `pgvector` en 0.8.7. La base de datos de Desarrollo Seguro es un contenedor y volumen independientes de Grumphya; no se comparte el clúster ni el volumen. Node.js de los servicios se mantiene en la línea 26 LTS y adopta su último parche publicado.

## Invariantes de seguridad y datos

- No montar un volumen PostgreSQL 17 bajo el servidor PostgreSQL 19 ni reutilizar la misma ruta de datos entre majors.
- Mantener el volumen PG17 sin modificaciones y restaurar en un volumen PG19 distinto. El dump lógico debe incluir roles, todas las bases conectables, privilegios, extensiones y datos.
- Antes de la copia final, detener escrituras de API, worker y schedulers; no detener ni reiniciar esos procesos mientras haya una investigación de certificación o análisis acordada en curso.
- Comparar origen y destino antes de abrir tráfico: major, extensión `vector` cuando exista, inventario de bases/roles, migraciones, filas por tabla, secuencias, índices y permisos. No registrar hostnames ni filas de contenido en los resultados.
- Hasta completar una copia externa restaurada y el ensayo de corte, PG17 permanece como versión por defecto en producción. CI prueba PG19 en cada push.
- Un rollback antes de reabrir escrituras puede volver al volumen PG17. Después de admitir escrituras en PG19, el PG17 queda obsoleto y no se puede reactivar sin un plan de reconciliación de datos.
- Mantener `AUDIT_ENABLED=false` durante cualquier ensayo efímero; una puntuación de auditoría no sustituye la validación de los datos.

## Criterios de aceptación

1. Las pruebas PostgreSQL de CI usan PostgreSQL 19. La candidata de producción se construye desde `docker/postgres/Dockerfile` sobre Debian 13 Trixie, actualiza los paquetes disponibles y recompila `gosu` con Go parcheado; CI escanea esa imagen exacta con Trivy y ejecuta sobre ella el ensayo de restauración. Conserva el informe completo, pero la puerta bloquea los hallazgos corregibles; no atribuye una mitigación ficticia a CVE que aún no tienen paquete corregido en Debian.
2. Una prueba sintética restaura desde PG17 a un clúster limpio PG19 con volumen independiente, preservando roles, bases, tablas, datos, permisos, extensión e índice HNSW; limpia solo sus volúmenes efímeros.
3. La composición admite configurar imagen, `PGDATA`, ruta de montaje y nombre versionado de volumen, y mantiene valores PG17 existentes por defecto hasta autorizar el corte.
4. Node, Dockerfile y documentación del entorno local quedan alineados con Node 26.13.1.
5. El workflow normal de push no despliega ni migra producción. El corte público requiere que haya acabado la investigación de certificación en curso, un backup externo restaurado y validaciones operativas de ambas aplicaciones.

## Verificación posterior al corte

Desarrollo Seguro debe pasar sus pruebas de integración, comprobación TLS/health, lectura del sello de Grumphya y análisis sintético. Grumphya debe pasar health, verificación del sello, evaluación y respuesta de roast. El proxy y sus certificados no se deben reiniciar durante la operación de bases salvo que las comprobaciones muestren que sea necesario.
