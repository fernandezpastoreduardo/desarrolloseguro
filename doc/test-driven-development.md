# Desarrollo guiado por pruebas

Los cambios de comportamiento siguen TDD. Antes de implementar o corregir lógica:

1. Añade o ajusta una prueba que describa el comportamiento esperado.
2. Ejecuta esa prueba y confirma que falla por la razón prevista.
3. Implementa el cambio mínimo que la haga pasar.
4. Ejecuta la prueba enfocada, refactoriza y vuelve a ejecutarla.
5. Ejecuta las puertas completas de lint, tipos, pruebas, cobertura, build y análisis Sonar local cuando corresponda.

En el informe del cambio se indica qué prueba falló primero y qué ejecución confirmó el estado verde. No se inventa una fase roja retrospectiva. Los cambios exclusivamente documentales no requieren una prueba de comportamiento. Para cambios de configuración, define primero una comprobación que falle ante una configuración inválida y verifica después el estado corregido.

CI demuestra que las pruebas pasan en el commit; no prueba por sí solo que se haya seguido el orden rojo-verde. La secuencia se registra como parte del trabajo revisable.

## Análisis Sonar local

SonarQube Community Build es una herramienta local opcional. Levántala con `doc/sonarqube-local.md` y analiza el repositorio con `pnpm quality:sonar`. El servidor enlaza únicamente con loopback, usa una red Docker interna y tiene desactivada la telemetría. No se añade análisis Sonar a GitHub Actions ni al frontend público.
