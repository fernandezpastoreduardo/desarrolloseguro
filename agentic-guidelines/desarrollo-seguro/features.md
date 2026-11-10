# Features

Este documento separa capacidades ya disponibles de los siguientes incrementos. El estado operativo vigente está en [README.md](README.md).

## F1. Consultar informes públicos

Una persona puede introducir un hostname público normalizado y consultar si existe un informe reciente. La consulta no admite URL, credenciales, IP literal, puerto ni ruta aportada por el usuario. Las rutas públicas aprobadas por el perfil actual son `/`, `/precios` y `/informe`; la API aplica esa lista por igual a cada hostname.

**Disponible:** API `GET` de estado e informe, limitación de solicitudes en memoria y proyección que excluye evidencia interna. No se resuelven hostnames ni se encolan trabajos desde estas rutas.

**Criterios:** errores y ausencia de informe no muestran un resultado inventado; respuestas llevan `Cache-Control: no-store`; el estado `not_scanned` indica que no existe observación.

## F2. Informes y evidencia

Un informe identifica hostname, perfil, rutas cubiertas, métodos, resultados, fecha UTC, punto de observación y límites. `same_vps` indica que la muestra procede del mismo VPS donde se ejecuta el servicio; no implica una observación independiente desde Internet.

**Criterios:** solo se publican campos permitidos; el contenido libre se redacta o sustituye por texto controlado; cada control incluye limitaciones; ningún `pass` se presenta como certificación, cumplimiento legal o ausencia de vulnerabilidades.

## F3. Escaneo automatizado

Capacidad futura. Antes de activarla deben implementarse el executor y sus límites de red, probar DNS/IP pinning por conexión y redirección, aislar egress IPv4/IPv6 y validar carga y privacidad. No se hacen POST, autenticación, fuzzing, fuerza bruta ni exploración arbitraria.

**Criterios:** cualquier fallo de cobertura, transporte o política deja el control como `unknown`/no evaluable; no se convierte en aprobado. El modelo de amenazas y los límites de confianza están en [scanner-safety.md](scanner-safety.md); el executor permanece apagado hasta demostrar allí los gates de red, aislamiento y evidencia.

## F4. Almacenamiento y operación

La API, web y PostgreSQL se ejecutan en contenedores independientes con redes, volumen y secretos propios. El host publica el portal solo en loopback (`127.0.0.1:18080`) para que un proxy de borde configurado aparte pueda servirlo.

**Criterios:** la base no comparte tablas, volúmenes o credenciales con otros sistemas; detener o actualizar este stack no ejecuta cambios en otros proyectos; backup y restauración se prueban sobre una instancia aislada.

## Perfil reducido `transport-v1`

La migración 007 registra un perfil nuevo e inmutable, con alcance solo `/` y cobertura exacta de cinco comprobaciones: DNS, TLS, HTTP HEAD, HTTP GET y cabeceras HTTPS. Excluye privacidad y calidad porque aún no hay observadores para esos controles. Core, persistencia, API y portal reconocen la versión; el ensamblador fixture-only valida cobertura, degradación a `unknown` ante errores y cálculo de veredicto, mientras los fixtures sintéticos recorren también las reglas de ingesta y la representación pública. El executor de red puede recorrer el procesador con dependencias inyectadas y producir métricas de solicitudes/bytes, pero no está conectado a un worker arrancable ni produce análisis operativos.

## Límite actual

No hay worker arrancable, scheduler ni admisión de trabajos desde la API. El observador compone DNS/IP validado, TLS, HTTP→HTTPS en puerto 80 y cabeceras derivadas; el executor entrega esa proyección al procesador cuando se inyecta explícitamente y limita cada scan a dos sondas simultáneas para ajustarse al límite DNS local. Cuenta intentos HTTP(S) y bytes recibidos por socket (incluye negociación TLS cuando el socket la informa; en dobles sintéticos usa el cuerpo observado como mínimo). No cuenta consultas DNS ni bytes enviados. Los errores TLS se reducen a categorías seguras. Faltan pruebas de extremo a extremo con servidores locales, la frontera de proceso sin credenciales, cuotas compartidas y aislamiento egress validado. Ver [scanner-safety.md](scanner-safety.md) y [test-plan.md](test-plan.md) antes de habilitar ejecución de red.
