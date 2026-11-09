# Seguridad de ejecución de análisis

La función de análisis remoto no está habilitada. La API actual no acepta scans y no hay worker ejecutable ni transporte de red. No activar un executor público hasta implementar y probar las barreras de esta guía.

## Límites de red

El diseño futuro debe aislar el proceso que navega páginas: sin credenciales de base, secretos, Docker socket, montajes del host ni privilegios. La salida debe pasar por un conector controlado que resuelva y valide A/AAAA, fije la IP usada por cada conexión y redirección, y preserve Host/SNI y validación TLS. Bloquear loopback, redes privadas, link-local, metadatos, ULA IPv6, redes Docker y servicios del host. Si no puede aplicarse una política equivalente para IPv6, deshabilitarlo en el executor.

No confiar solo en `internal: true` o en reglas `DOCKER-USER`: también deben probarse el tráfico hacia el host (`INPUT`), el tráfico reenviado, la gateway del bridge, DNS, redirecciones y hairpin. No instalar reglas genéricas en el host donde se ejecute otra aplicación; la política debe limitarse a interfaces y subredes propias del stack.

## Navegación y cuotas

Usar solo solicitudes GET/HEAD, sin formularios, mutaciones, fuzzing ni herramientas DAST activas. El navegador debe ejecutarse sin credenciales en un contexto temporal. Bloquear solicitudes secundarias a otros orígenes antes de conectar.

Antes de abrir la función, imponer límites compartidos de concurrencia, frecuencia, tiempo, redirecciones, solicitudes, bytes, tamaño de documento, memoria, CPU, procesos, cola y almacenamiento. El limitador por proceso de la API no sustituye cuotas compartidas para scans. No persistir HTML, capturas, cookies, tokens, IP de visitantes ni cuerpos de respuesta.

## Casos adversarios mínimos

Probar IPv4/IPv6 privadas, loopback, gateway/host, metadatos, CNAME privado, DNS rebinding, redirecciones a IP privada y a otro hostname, puertos internos, respuestas lentas/infinitas, compresión explosiva, recursos de terceros y navegación JavaScript a direcciones internas. Verificar que no llega tráfico a servicios señuelo. Cualquier fallo mantiene el executor deshabilitado.
