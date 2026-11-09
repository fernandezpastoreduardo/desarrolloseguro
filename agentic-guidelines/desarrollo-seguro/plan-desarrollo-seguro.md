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

La API de solo lectura, la proyección pública de informes, la persistencia, la landing y el portal React están implementados. Las políticas y algunos adaptadores de red tienen pruebas locales. No existe todavía un worker arrancable, executor, scheduler ni escaneo real.

## Entregas siguientes

1. Completar el modelo de amenazas y el contrato versionado de cada control.
2. Terminar aislamiento de red y política de egress antes de conectar sockets a destinos públicos.
3. Añadir admisión de trabajos, límites globales, cola, reintentos y telemetría sin datos sensibles.
4. Validar una prueba controlada en un entorno desechable, con alcance y límites documentados.
5. Medir recursos, probar backup/restauración y revisar accesibilidad antes de cualquier publicación amplia.

Cada entrega debe incluir pruebas que expresen el contrato, revisión de seguridad y cambios coordinados en [features.md](features.md), [controls-and-evidence.md](controls-and-evidence.md) y [test-plan.md](test-plan.md). Si una puerta falla, el resultado permanece no evaluable y no se publica un `pass`.
