# Auditoría de URL y medición de rendimiento

El buscador público admite una URL HTTPS completa. La auditoría se limita a
esa ruta y conserva su query; elimina el fragmento, rechaza credenciales y
puertos distintos del HTTPS por defecto. La cola guarda la URL hasta que el
trabajo termina y la elimina entonces. El informe persistido conserva la ruta
y la query como parte de su alcance.

La protección contra abuso aplica un límite de 24 horas a cada URL normalizada
(hostname, ruta y query, sin fragmento), además del límite de solicitudes por
minuto y de cola. Solo puede ejecutarse un análisis solicitado por hostname a
la vez. Una petición duplicada de la misma URL activa reutiliza ese trabajo;
otra ruta/query espera a que termine sin reutilizar el resultado ajeno. Los
escaneos programados tampoco consumen el límite de una URL solicitada.

En cada deploy autorizado, el provisionador avanza un epoch global de admisión
antes de actualizar los servicios. Los informes anteriores al deploy dejan de
consumir la caché de 60 minutos y el cooldown de 24 horas para cualquier URL;
se conservan intactos en el historial y el cambio no genera análisis por sí
solo. Una nueva solicitud puede producir un informe con el código desplegado,
sujeta a los límites de cola, solicitudes y ejecución concurrente.

Rendimiento se mide en Chromium, en contextos nuevos para móvil y escritorio.
Móvil usa 375×812, CPU 4× y red de 150 ms RTT, 1,6 Mbps de bajada y 750 Kbps
de subida. Escritorio usa 1365×768 sin throttling. Las métricas son FCP, LCP,
CLS, TBT, TTFB y bytes transferidos. El informe muestra una nota propia de
0–100 basada en umbrales buenos y malos e interpolación lineal; no es una
puntuación oficial de Lighthouse ni un Core Web Vital de usuarios reales. La
nota de la tarjeta es la media aritmética de las dos notas de perfil.

| Métrica | Peso | Umbral bueno (100) | Umbral malo (0) |
| --- | ---: | ---: | ---: |
| FCP | 15 % | 1,8 s | 3 s |
| LCP | 25 % | 2,5 s | 4 s |
| CLS | 20 % | 0,1 | 0,25 |
| TBT | 20 % | 200 ms | 600 ms |
| TTFB | 15 % | 800 ms | 1,8 s |
| Datos transferidos | 5 % | 1,6 MB | 4 MB |

Cada subnota se interpola linealmente entre ambos umbrales y se limita a
0–100. Si falta cualquier métrica del perfil, ese perfil queda sin nota y la
tarjeta no promedia resultados parciales.

La prueba incluye recursos HTTPS de terceros que la página cargue mediante
GET/HEAD. El proxy valida los destinos, fija DNS a IPv4 pública y limita
solicitudes, bytes y duración. No envía formularios ni realiza acciones de
escritura.
