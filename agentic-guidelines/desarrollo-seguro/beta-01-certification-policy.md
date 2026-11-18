# Beta 0.1 — política de puntuación y elegibilidad

Este documento define la política de la Beta 0.1. La evaluación se persiste
por dominio y alimenta el estado público de la certificación.

## Controles incluidos

La política solo evalúa controles que ya tienen un contrato de observación en
el repositorio:

| Categoría | Controles | Peso |
| --- | --- | ---: |
| Seguridad TLS | `DS-TLS-01`, `DS-TLS-02` | 40 |
| Cabeceras de seguridad | `DS-HDR-01` | 30 |
| Cookies y privacidad observable | `DS-PRIV-05` | 30 |

Los controles desconocidos no se consideran superados ni fallidos y quedan
fuera del denominador de la puntuación. Una evaluación con controles
obligatorios desconocidos no puede activar una certificación.

## Elegibilidad

- `eligible`: las tres categorías tienen resultado concluyente, la puntuación
  es igual o superior a 90 y no ha fallado un control crítico.
- `pending`: falta evidencia concluyente para alguna categoría.
- `blocked`: existe un fallo crítico o la puntuación concluyente es inferior a
  90.

Los controles TLS son críticos. La migración 023 aplica estas transiciones:

- el primer resultado `eligible` activa la certificación;
- un resultado bloqueante suspende una certificación que estaba activa;
- un resultado `pending` conserva una certificación activa mientras se revisa
  la evidencia;
- un resultado `eligible` posterior reactiva una certificación suspendida.

Los fallos del worker no generan un informe y no alteran el estado anterior.

## Límites

La política no infiere consentimiento, venta de datos, comportamiento
dinámico de scripts ni rendimiento completo. Esos aspectos requieren controles
con evidencia propia antes de poder afectar a la puntuación.
