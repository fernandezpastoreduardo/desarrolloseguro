# Excepción temporal para actualizar informes vigentes

## Objetivo y alcance

Permitir, hasta que el responsable lo desactive, solicitar una auditoría nueva
de cualquier URL HTTPS aunque su informe anterior siga vigente. La excepción
aplica a todos los dominios.

## Comportamiento

- El modo se controla con una opción persistida en `ds_scan_admission_epoch`.
  Su valor inicial y seguro es desactivado.
- Activado, omite el retorno del informe reciente en caché y el cooldown de 24
  horas para una auditoría completada de la misma ruta/query.
- Desactivado, se mantiene el comportamiento vigente.
- El modo no expira automáticamente; permanece hasta que se cambie de nuevo.
- Continúan activos: rate limits HTTP por IP/dominio, deduplicación de una
  URL con trabajo pendiente/activo, un único trabajo solicitado activo por
  hostname y límite de diez trabajos en cola.
- El rol público no obtiene acceso directo a la opción. Solo la función SQL de
  admisión, bajo `SECURITY DEFINER`, la consulta.

## Activación y reversión

Un operador con acceso administrativo a la base puede activar el modo poniendo
`allow_fresh_report_refresh` en `true` en la fila singleton de
`ds_scan_admission_epoch`; al recibir la orden de restablecer límites, lo pone
en `false`. La operación debe verificar que afectó exactamente una fila y
confirmar el valor con una lectura posterior.

## Criterios de aceptación

1. En modo desactivado, informes vigentes y solicitudes recientes siguen
   aplicando caché y cooldown.
2. En modo activado, puede encolarse una nueva auditoría tras completarse una
   anterior para la misma URL.
3. Un trabajo activo para la misma URL se deduplica y los otros límites
   antiabuso/capacidad siguen aplicándose en ambos modos.
4. La prueba PostgreSQL cubre el comportamiento activado y desactivado.
5. La reversión administrativa puede activarse o desactivarse sin reconstruir
   imágenes ni desplegar código.
