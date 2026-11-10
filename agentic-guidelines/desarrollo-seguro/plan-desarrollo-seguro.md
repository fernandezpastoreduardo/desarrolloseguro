# Plan de producto y arquitectura

## Propósito

Presentar evidencia reproducible sobre controles observables de páginas públicas y explicar qué cubre cada resultado. El informe no debe sugerir certificación, auditoría completa, cumplimiento legal ni ausencia de vulnerabilidades.

## Arquitectura

- Aplicación TypeScript con módulos separados: `core`, `persistence`, `api`, `web` y `worker`.
- PostgreSQL propio con roles mínimos y migraciones versionadas.
- Contenedores y volumen Docker propios. El portal se publica en loopback; API y base no tienen puertos del host.
- El proxy de borde y el dominio se configuran por el operador fuera del stack.
- No se comparten datos, credenciales, redes o ciclos de despliegue con otros productos.

## Estado

La API de solo lectura, la proyección pública de informes, la persistencia, la landing y el portal React están implementados. El worker contiene el procesador por lease, el observador y executor `transport-v1`, y un canal JSON a un proceso hijo que no recibe lease ni variables de entorno. El coordinador valida el resultado y mantiene persistencia. Las primeras dos iteraciones se completaron: HTTP→HTTPS local, TLS con certificado fixture, DNS rebinding sintético y recorrido child→processor→informe público en PostgreSQL temporal aislado. El hijo todavía comparte usuario y filesystem; no hay sandbox de sistema operativo, coordinador arrancable, scheduler ni escaneos reales.

El modelo de amenazas y el contrato local de controles están documentados en [`scanner-safety.md`](scanner-safety.md) y [`controls-and-evidence.md`](controls-and-evidence.md). Esto completa el entregable de diseño documental; no acredita las barreras de red en el VPS ni autentica observaciones de un executor.

## Entregas siguientes

1. Añadir admisión de trabajos, límites globales, cuotas, reintentos y telemetría sin datos sensibles, manteniendo la API pública de solo lectura hasta probar esos límites.
2. Construir y demostrar aislamiento de usuario/filesystem/red y política de egress en un runtime desechable antes de conectar el hijo a dominios públicos.
3. Validar una prueba controlada con alcance documentado, medir recursos y probar backup/restauración. El despliegue real solo llega después de superar esos gates.

Cada entrega debe incluir pruebas que expresen el contrato, revisión de seguridad y cambios coordinados en [features.md](features.md), [controls-and-evidence.md](controls-and-evidence.md) y [test-plan.md](test-plan.md). Si una puerta falla, el resultado permanece no evaluable y no se publica un `pass`.
