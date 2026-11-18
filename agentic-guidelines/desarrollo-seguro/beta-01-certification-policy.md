# Beta 0.1 — política de puntuación y elegibilidad

Este documento define el primer incremento implementable de la Beta 0.1. No
representa todavía una certificación persistida ni una ficha pública.

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

En este incremento los controles TLS son críticos. La transición de estado y
la persistencia de la evaluación se implementarán en features posteriores.

## Límites

La política no infiere consentimiento, venta de datos, comportamiento
dinámico de scripts ni rendimiento completo. Esos aspectos requieren controles
con evidencia propia antes de poder afectar a la puntuación.
