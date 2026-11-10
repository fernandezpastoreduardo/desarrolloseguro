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

La migración 007 registra un perfil nuevo e inmutable, con alcance solo `/` y cobertura exacta de cinco comprobaciones: DNS, TLS, HTTP HEAD, HTTP GET y cabeceras HTTPS. Excluye privacidad y calidad porque aún no hay observadores para esos controles. Core, persistencia, API y portal reconocen la versión; el ensamblador fixture-only valida cobertura y veredicto. El executor de red convierte las señales en los cinco controles y puede ejecutarse en proceso hijo sin recibir lease ni entorno del coordinador; el recorrido hasta un informe público se probó contra PostgreSQL aislado con una respuesta fixture.

## Límite actual

No hay worker coordinador arrancable, scheduler ni admisión de trabajos desde la API. El observador compone DNS/IP validado, TLS, HTTP→HTTPS en puerto 80 y cabeceras derivadas; el executor limita cada scan a dos sondas simultáneas, cuenta intentos HTTP(S) y bytes recibidos por socket y reduce errores TLS a categorías seguras. El proceso hijo no recibe credenciales ni el lease; comparte todavía usuario y filesystem con el coordinador, así que no es un sandbox. Pasan las pruebas HTTP/HTTPS locales, DNS rebinding sintético y el recorrido fixture hasta PostgreSQL temporal. Faltan aislamiento de runtime/egress, cuotas compartidas y una prueba del executor de red dentro del proceso aislado. Ver [scanner-safety.md](scanner-safety.md) y [test-plan.md](test-plan.md) antes de habilitar ejecución de red.

Los fallos de ejecución ahora se liberan con una transición PostgreSQL condicionada al lease vigente: máximo tres intentos, backoff exponencial limitado a 60 segundos y categoría pública fija `executor_failed`. No se almacenan mensajes del runtime. La función de claim serializa los workers y permite como máximo un scan global en ejecución, con una prueba concurrente sobre dominios distintos. Hay imágenes separadas para executor y broker; `pnpm sandbox:check` valida el executor en Linux sin red, con usuario no privilegiado, filesystem de solo lectura, capacidades vacías y límites de recursos, además de un volumen efímero de broker por trabajo. `createEgressDestinationAuthorizer` limita a hostname exacto y puertos 80/443, y ahora sus direcciones validadas se entregan directamente al socket HTTP/TLS. Sigue faltando integrar un coordinador al worker y firewall verificable para el broker; no se habilitan scans ni admisión pública.
