# Features

Este documento separa capacidades ya disponibles de los siguientes incrementos. El estado operativo vigente está en [README.md](README.md).

## F1. Consultar informes públicos

Una persona puede introducir un hostname público normalizado y consultar si existe un informe reciente. La consulta no admite URL, credenciales, IP literal, puerto ni ruta aportada por el usuario. Las rutas públicas aprobadas por el perfil actual son `/`, `/precios` y `/informe`; la API aplica esa lista por igual a cada hostname.

**Disponible:** API `GET` de estado e informe y `POST` explícito para solicitar un análisis; limitación por proceso, cuotas compartidas PostgreSQL y proyección que excluye evidencia interna. La consulta `GET` no resuelve hostnames ni encola trabajos. La solicitud `POST` requiere confirmación de autorización y guarda una admisión `on_demand` de forma transaccional. Si se encola, el portal consulta el estado cada cinco segundos, hasta 15 minutos mientras haya trabajo activo, y presenta el informe nuevo cuando queda guardado. Si no aparece trabajo activo ni informe nuevo tras admitir la solicitud, detiene el sondeo y permite reintentar en vez de dejar consultas repetidas y ocultar el desajuste como un informe simplemente ausente. El worker sigue fuera del despliegue, por lo que aceptar una solicitud no produce tráfico ni resultado operativo.

**Criterios:** errores y ausencia de informe no muestran un resultado inventado; respuestas llevan `Cache-Control: no-store`; el estado `not_scanned` indica que no existe observación.

## F2. Informes y evidencia

Un informe identifica hostname, perfil, rutas cubiertas, métodos, resultados, fecha UTC, punto de observación y límites. `same_vps` indica que la muestra procede del mismo VPS donde se ejecuta el servicio; no implica una observación independiente desde Internet.

**Criterios:** solo se publican campos permitidos; el contenido libre se redacta o sustituye por texto controlado; cada control incluye limitaciones; ningún `pass` se presenta como certificación, cumplimiento legal o ausencia de vulnerabilidades.

## F3. Escaneo automatizado

La solicitud desde el producto y la admisión compartida están preparadas. El executor y los límites por trabajo existen; la cola limita a diez trabajos en espera globales y una ejecución simultánea, con máximo 1000 dominios `on_demand`. Durante la fase de pruebas se desactivan temporalmente el intervalo de 24 horas y la reutilización de informes recientes; hay que reactivarlos antes de producción. Antes de mantener activo el worker deben probarse DNS/IP pinning por conexión y redirección, aislar egress IPv4/IPv6, verificar topes bajo carga y privacidad, y validar el firewall del runtime con servicios señuelo. No se hacen POST al sitio analizado, autenticación en esos sitios, fuzzing, fuerza bruta ni exploración arbitraria.

**Criterios:** cualquier fallo de cobertura, transporte o política deja el control como `unknown`/no evaluable; no se convierte en aprobado. El modelo de amenazas y los límites de confianza están en [scanner-safety.md](scanner-safety.md); el executor permanece apagado hasta demostrar allí los gates de red, aislamiento y evidencia.

## F4. Almacenamiento y operación

La API, web y PostgreSQL se ejecutan en contenedores independientes con redes, volumen y secretos propios. El host publica el portal solo en loopback (`127.0.0.1:18080`) para que un proxy de borde configurado aparte pueda servirlo.

**Criterios:** la base no comparte tablas, volúmenes o credenciales con otros sistemas; detener o actualizar este stack no ejecuta cambios en otros proyectos; backup y restauración se prueban sobre una instancia aislada.

## Perfil reducido `transport-v1`

La migración 007 registra un perfil nuevo e inmutable, con alcance solo `/` y cobertura exacta de cinco comprobaciones: DNS, TLS, HTTP HEAD, HTTP GET y cabeceras HTTPS. Excluye privacidad y calidad porque aún no hay observadores para esos controles. Core, persistencia, API y portal reconocen la versión; el ensamblador fixture-only valida cobertura y veredicto. El executor de red convierte las señales en los cinco controles y puede ejecutarse en proceso hijo sin recibir lease ni entorno del coordinador; el recorrido hasta un informe público se probó contra PostgreSQL aislado con una respuesta fixture.

## Límite actual

El entrypoint worker (`pnpm --filter @desarrolloseguro/worker start`) compone el store PostgreSQL con rol `ds_worker`, procesador por lease, cliente del supervisor Unix y telemetría allowlisted. Usa polling serial, backoff limitado y parada por SIGINT/SIGTERM; requiere un secreto DB en fichero y propietario/grupo esperados para el socket. El supervisor tiene un entrypoint (`start:coordinator`) que enlaza servidor Unix y runner Docker, valida configuración y fija un socket Docker local explícito. Compose ahora define ambos procesos de análisis; el coordinador es el único que monta el socket Docker y no tiene red propia. El worker solo comparte el socket Unix con él y pertenece al backend interno. El scheduler separado ejecuta diariamente el purgado de informes de más de 90 días usando `ds_retention`. El observador fija DNS/IP validado, aplica TLS, HTTP→HTTPS y deriva evidencia de cabeceras; el executor limita sondas, intentos y bytes y reduce errores TLS a categorías seguras. Los análisis no se deben habilitar hasta desplegar y verificar las reglas de egress y obtener un informe real desde el portal. Ver [scanner-safety.md](scanner-safety.md) y [test-plan.md](test-plan.md).
