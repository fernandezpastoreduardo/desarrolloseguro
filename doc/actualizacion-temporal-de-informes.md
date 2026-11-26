# Actualización temporal de informes vigentes

El modo temporal permite pedir otra auditoría aunque el informe de esa URL
siga vigente. Se aplica a todos los dominios y permanece activo hasta cambiar
su valor en PostgreSQL. Las peticiones siguen sujetas a los límites de
solicitudes por minuto, la deduplicación de trabajos activos, un trabajo
solicitado simultáneo por hostname y la capacidad máxima de cola.

Con una conexión administrativa a la base `desarrollo_seguro`, activa el modo:

```sql
UPDATE public.ds_scan_admission_epoch
SET allow_fresh_report_refresh = true
WHERE singleton IS TRUE;
```

Para restablecer el caché y el cooldown de 24 horas:

```sql
UPDATE public.ds_scan_admission_epoch
SET allow_fresh_report_refresh = false
WHERE singleton IS TRUE;
```

Después de cada cambio, verifica que se modificó una fila y lee el estado:

```sql
SELECT allow_fresh_report_refresh
FROM public.ds_scan_admission_epoch
WHERE singleton IS TRUE;
```

El modo está desactivado por defecto. El rol de la API no puede consultar ni
cambiar esta opción directamente.
