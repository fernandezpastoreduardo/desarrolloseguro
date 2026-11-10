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

La API de solo lectura, la proyección pública de informes, la persistencia, la landing y el portal React están implementados. El worker contiene el procesador por lease, un observador `transport-v1` compuesto con DNS público fijado y transportes HTTP/HTTPS acotados, un executor fixture-only y un executor de red que deriva el veredicto, convierte fallos de observación en `unknown` y suma contadores de transporte. El recorrido del executor de red por el procesador se cubre con dependencias sintéticas. No hay proceso worker arrancable, scheduler ni escaneos reales.

El modelo de amenazas y el contrato local de controles están documentados en [`scanner-safety.md`](scanner-safety.md) y [`controls-and-evidence.md`](controls-and-evidence.md). Esto completa el entregable de diseño documental; no acredita las barreras de red en el VPS ni autentica observaciones de un executor.

## Entregas siguientes

1. Validar los adaptadores de transporte con servidores HTTP/HTTPS sintéticos y escenarios de DNS rebinding; comprobar contadores de socket/cuerpo y categorías seguras de errores TLS. Mantener la ejecución real apagada.
2. Separar el executor de red sin credenciales y diseñar su canal con el coordinador de persistencia; verificar el recorrido completo de informe en PostgreSQL aislado.
3. Añadir admisión de trabajos, límites globales, cuotas, reintentos y telemetría sin datos sensibles, manteniendo la API pública de solo lectura hasta probar esos límites.
4. Terminar y demostrar aislamiento de red y política de egress en un runtime desechable antes de conectar sockets a dominios públicos.
5. Validar una prueba controlada con alcance documentado, medir recursos y probar backup/restauración. El despliegue real solo llega después de superar esos gates.

Cada entrega debe incluir pruebas que expresen el contrato, revisión de seguridad y cambios coordinados en [features.md](features.md), [controls-and-evidence.md](controls-and-evidence.md) y [test-plan.md](test-plan.md). Si una puerta falla, el resultado permanece no evaluable y no se publica un `pass`.
