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

La API de solo lectura, la proyección pública de informes, la persistencia, la landing y el portal React están implementados. El paquete worker contiene el procesador de trabajos por lease y adaptadores DNS/HTTPS cubiertos por pruebas locales. El perfil `transport-v1` limita la primera cobertura a cuatro controles sobre la portada y cuenta con recorrido sintético de observaciones hasta las proyecciones de informe. No existe todavía un executor de red integrado, un proceso worker arrancable, scheduler ni escaneo real.

El modelo de amenazas y el contrato local de controles están documentados en [`scanner-safety.md`](scanner-safety.md) y [`controls-and-evidence.md`](controls-and-evidence.md). Esto completa el entregable de diseño documental; no acredita las barreras de red en el VPS ni autentica observaciones de un executor.

## Entregas siguientes

1. Construir el executor local para `transport-v1` usando las primitivas validadas y observadores de fixture; mantener la ejecución real apagada.
2. Diseñar el límite entre executor sin secretos y coordinador/persistencia con credenciales; verificar el recorrido completo de persistencia e informe en PostgreSQL aislado.
3. Añadir admisión de trabajos, límites globales, cuotas, reintentos y telemetría sin datos sensibles, manteniendo la API pública de solo lectura hasta probar esos límites.
4. Terminar y demostrar aislamiento de red y política de egress en un runtime desechable antes de conectar sockets a dominios públicos.
5. Validar una prueba controlada con alcance documentado, medir recursos y probar backup/restauración. El despliegue real solo llega después de superar esos gates.

Cada entrega debe incluir pruebas que expresen el contrato, revisión de seguridad y cambios coordinados en [features.md](features.md), [controls-and-evidence.md](controls-and-evidence.md) y [test-plan.md](test-plan.md). Si una puerta falla, el resultado permanece no evaluable y no se publica un `pass`.
