# Progreso público de las auditorías

Mientras se ejecuta una auditoría, la ficha puede mostrar el estado de Ética,
Privacidad, Seguridad y Rendimiento por separado. La API obtiene esos estados
de `progress_json` en la cola de trabajos y los publica mediante una proyección
acotada.

La provisión de producción concede a la API lectura de esa columna a través del
rol `ds_read`. El permiso no incluye `lease_token` ni habilita escritura sobre
los trabajos. La prueba PostgreSQL de provisión comprueba ambas condiciones.
El smoke de despliegue comprueba después que el estado público de Grumphya y su
auditoría responden correctamente.
