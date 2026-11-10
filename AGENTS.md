# Directrices del repositorio

## Arquitectura

### Regla de alcance

El alcance del uso determina la ubicación del código:

- Código usado por dos o más features va en `src/shared` o en el paquete compartido correspondiente.
- Código usado por una sola feature permanece dentro de esa feature.
- Cuando el uso futuro no esté demostrado, mantenerlo local y extraerlo al aparecer el segundo consumidor.

### Arquitectura que expresa el producto

- Los nombres de features describen capacidad de negocio, no tecnología.
- La estructura debe permitir entender el propósito del sistema con una lectura rápida.
- Los contenedores se nombran como su feature y coordinan estado, servicios y flujo de datos.
- Los componentes presentacionales reciben props y se centran en la interfaz.

### Estructura frontend

```text
src/
  features/[feature-name]/
    [feature-name].tsx
    components/
    services/
    hooks/
    models.ts
  shared/
    components/
    hooks/
    utils/
  infrastructure/
    api/
    auth/
    monitoring/
```

Antes de mover un componente, comprobar sus imports reales, contar los consumidores y anotar la decisión de alcance.

## Implementación y seguridad

- Usa TypeScript estricto. Valida en ejecución los datos externos; trata `unknown` mediante comprobaciones explícitas.
- Extrae strings repetidos cuando aparecen más de dos veces y expresiones regulares repetidas cuando aparecen más de una vez.
- Evita ternarios anidados y sustituye lógica compleja de UI por funciones nombradas.
- Elimina variables sin uso y no uses `any` para silenciar errores de tipos.
- Maneja errores sin registrar contraseñas, tokens, ideas, texto de usuario ni otros datos sensibles. Registra códigos o categorías seguras.
- Usa HTML semántico antes de añadir ARIA. Los elementos decorativos deben excluirse del árbol accesible.
- Los límites y permisos se aplican en el servidor; el cliente solo presenta el estado devuelto por la API.
- Mantén pruebas y fixtures aislados de servicios, datos y secretos reales.

## Desarrollo

- Usa pnpm exclusivamente. Node y pnpm están fijados en `.node-version` y `package.json`.
- Sigue TDD para todo cambio de comportamiento: primero prueba nueva o ampliada, ejecútala y confirma un fallo por la razón prevista, implementa el cambio mínimo y repite hasta verde antes de refactorizar. Registra la evidencia roja y verde en el informe del cambio. Consulta [Desarrollo guiado por pruebas](doc/test-driven-development.md).
- Cada cambio funcional debe incluir pruebas de unidad, integración o navegador acordes con su alcance.
- Antes de finalizar, ejecuta `pnpm lint`, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm test:coverage` y, si el servicio local está disponible, `pnpm quality:sonar`; describe cualquier puerta que no se haya podido ejecutar y por qué.
- Conserva los límites y supuestos descritos en `agentic-guidelines/desarrollo-seguro/` y `doc/`; actualiza la documentación afectada junto con el código.
- Los datos de muestra solo se usan en desarrollo y pruebas. No se presentan como evidencia real.

## Commits y publicación

Usa mensajes Conventional Commits, sin atribución automática de IA:

```text
feat: add public report summary
test: cover report access policy
refactor: isolate report projection
```

Atajo del usuario: `decopu` significa «descripción relevante, commit, push». Cuando se solicite, redacta descripciones claras, separa cambios en commits pequeños y coherentes y publica cada commit individualmente en el destino autorizado.
