# Seguridad de ejecución de análisis

La función de análisis remoto no está habilitada. La API actual no acepta scans y no hay un worker coordinador ejecutable que tome trabajos y persista resultados. El paquete worker contiene un observador local compuesto de DNS/HTTP/HTTPS, un canal que puede ejecutarlo como proceso hijo y pruebas locales; su presencia no demuestra aislamiento de filesystem, egress ni permite activar análisis. No conectar este observador a trabajos públicos hasta implementar y probar las barreras de esta guía.

## Modelo de amenazas y límites de confianza

El activo protegido incluye la red y los servicios del host, la base de datos y sus credenciales, los informes persistidos, y la disponibilidad del VPS. El hostname y todo contenido recibido del sitio analizado se consideran entrada no confiable. La cola y los resultados de un proceso worker también se consideran no confiables hasta que el servicio de persistencia valide el lease, el contrato de controles y la coherencia del veredicto.

| Amenaza | Límite que se intenta cruzar | Control requerido | Evidencia antes de habilitar scans |
| --- | --- | --- | --- |
| SSRF, DNS rebinding o redirección a una IP interna | Executor hacia loopback, redes privadas, gateway, metadatos o servicios del host | Resolver y validar A/AAAA, fijar la IP en cada conexión y repetir la validación para cada redirección; preservar hostname/SNI y validación TLS | Pruebas IPv4/IPv6 con DNS cambiante, CNAME privado, redirecciones y servicios señuelo; confirmar que no reciben tráfico |
| Página remota que intenta acceder a otros orígenes | Navegador del executor hacia destinos distintos al hostname y rutas admitidos | No ejecutar JavaScript; permitir solo GET/HEAD a rutas enumeradas; bloquear solicitudes secundarias y puertos alternativos | Pruebas con redirects, recursos y navegación a destinos señuelo; confirmar que el transporte no conecta |
| Worker comprometido o bug en el parser | Proceso de análisis hacia secretos, base de datos, host o red arbitraria | Aislar el executor sin secretos, socket Docker ni montajes; canal de salida controlado con política por destino; limitar recursos y permisos | Inspección del despliegue y pruebas de egress desde el namespace real, incluyendo tráfico al host y a IPv6 |
| Agotamiento de recursos o abuso de cola | Solicitudes públicas hacia CPU, memoria, procesos, red, cola o almacenamiento | Admisión autenticada o limitada, cuotas globales, concurrencia acotada, deadlines y topes de solicitudes, bytes, documentos y persistencia | Prueba controlada de carga y evidencia de que las cuotas funcionan entre procesos |
| Evidencia fabricada o alterada | Resultado del worker hacia informes públicos y veredictos | Persistencia valida el lease, el esquema y los predicados; la frontera confiable debe derivar los datos de observaciones del transporte y no aceptar estados declarados por el worker | Pruebas de contrato y de extremo a extremo que inyecten datos inválidos; revisión de qué proceso puede escribir resultados |
| Exposición de datos | Logs, informes o archivos temporales hacia usuarios u operadores no autorizados | No guardar cuerpos, HTML, cookies, tokens ni IP de visitantes; redactar errores y limitar la evidencia persistida a allowlists | Revisar logs, temporales y proyección pública con casos sintéticos |

El despliegue actual reduce el alcance al no desplegar el worker y al mantener API y base en redes internas propias. `IsolatedTransportV1Executor` inicia un proceso con entorno vacío y le envía solo hostname/perfil; el proceso no recibe lease ni store, y el coordinador vuelve a validar el resultado antes de persistirlo. Esto separa datos por el canal, pero ambos procesos siguen usando el mismo usuario y filesystem del host, por lo que no constituye la frontera aislada descrita aquí. Esto tampoco demuestra el aislamiento de un futuro executor. En particular, `internal: true` en Compose no acredita por sí solo el bloqueo de tráfico al host, gateway, DNS, IPv6, tráfico reenviado o hairpin. Esas propiedades deben comprobarse en el host y runtime de despliegue escogidos.

El contrato de controles y evidencia está descrito en [controls-and-evidence.md](controls-and-evidence.md). Valida estructura y coherencia, pero no autentica observaciones. El executor no puede considerarse una fuente confiable hasta que el diseño pruebe cómo obtiene evidencia de conexiones reales y cómo impide que un worker aislado escriba valores inventados.

## Límites de red

El diseño futuro debe aislar el proceso que navega páginas: sin credenciales de base, secretos, Docker socket, montajes del host ni privilegios. La salida debe pasar por un conector controlado que resuelva y valide A/AAAA, fije la IP usada por cada conexión y redirección, y preserve Host/SNI y validación TLS. Bloquear loopback, redes privadas, link-local, metadatos, ULA IPv6, redes Docker y servicios del host. Si no puede aplicarse una política equivalente para IPv6, deshabilitarlo en el executor.

No confiar solo en `internal: true` o en reglas `DOCKER-USER`: también deben probarse el tráfico hacia el host (`INPUT`), el tráfico reenviado, la gateway del bridge, DNS, redirecciones y hairpin. No instalar reglas genéricas en el host donde se ejecute otra aplicación; la política debe limitarse a interfaces y subredes propias del stack.

## Navegación y cuotas

Usar solo solicitudes GET/HEAD, sin formularios, mutaciones, fuzzing ni herramientas DAST activas. El navegador debe ejecutarse sin credenciales en un contexto temporal. Bloquear solicitudes secundarias a otros orígenes antes de conectar.

Antes de abrir la función, imponer límites compartidos de concurrencia, frecuencia, tiempo, redirecciones, solicitudes, bytes, tamaño de documento, memoria, CPU, procesos, cola y almacenamiento. El limitador por proceso de la API no sustituye cuotas compartidas para scans. No persistir HTML, capturas, cookies, tokens, IP de visitantes ni cuerpos de respuesta.

## Casos adversarios mínimos

Probar IPv4/IPv6 privadas, loopback, gateway/host, metadatos, CNAME privado, DNS rebinding, redirecciones a IP privada y a otro hostname, puertos internos, respuestas lentas/infinitas, compresión explosiva, recursos de terceros y navegación JavaScript a direcciones internas. Verificar que no llega tráfico a servicios señuelo. Cualquier fallo mantiene el executor deshabilitado.
