# Evaluación Beta en informes públicos

Los informes públicos incluyen `betaCertification`, una lectura provisional de
los controles que ya tienen evidencia observable en el perfil del dominio.

En esta primera integración se consideran tres categorías:

- Seguridad TLS: 40 puntos.
- Cabeceras de seguridad: 30 puntos.
- Cookies y privacidad observable: 30 puntos.

La puntuación se normaliza solo con categorías concluyentes. Una categoría
desconocida no suma ni resta, pero mantiene la evaluación en estado pendiente.
Un fallo TLS crítico o una puntuación inferior a 90 bloquean la elegibilidad.

Esta evaluación no equivale todavía a una certificación persistida ni habilita
el sello. Tampoco interpreta consentimiento real, venta de datos, ejecución
dinámica de scripts o rendimiento completo.
