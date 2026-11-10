# Verificación y cobertura

La cobertura inicial de Vitest se midió con `pnpm test:coverage` el 10 de noviembre de 2026. Son porcentajes de líneas por paquete; `persistence` y `worker` tienen suites PostgreSQL aisladas que no entran en esta ejecución de Vitest normal.

| Paquete | Líneas cubiertas |
| --- | ---: |
| core | 99.62% |
| web | 91.41% |
| persistence | 56.14% |
| api | 95.37% |
| worker | 82.37% |

El agregado ponderado observado fue aproximadamente 82.1% de líneas. Los resultados son un punto de partida, no un objetivo ni una prueba de suficiencia funcional. La primera medición revela que `persistence` es el principal hueco; antes de elevar umbrales globales se revisarán rutas críticas y los tests PostgreSQL.

El primer análisis SonarQube local se completó el 10 de noviembre de 2026. La Quality Gate quedó `PASSED`; inicialmente registró 80.5% de cobertura Sonar, 0.0% de duplicación, 4 bugs, 1 vulnerabilidad, 18 code smells y 0 security hotspots. La cobertura de Sonar usa su propio modelo de líneas y no coincide necesariamente con el agregado ponderado de Vitest.

El backlog inicial se revisó y corrigió siguiendo TDD. La clave de test ya no está versionada: se genera con OpenSSL desde `/usr/bin/openssl` dentro de un temporal privado, y una prueba verifica que `PATH` no pueda sustituir el ejecutable. Se corrigió la comparación del fixture del protocolo y se hizo explícito el encadenamiento de promesas del coordinador. Las alertas sobre CIDR de direcciones reservadas y el `try` síncrono del limitador DNS se documentaron en su línea porque esos literales son necesarios para bloquear respuestas no públicas y la promesa ya se gestiona después del `try`.

El último análisis local, tras esas correcciones, registró Quality Gate `PASSED`, 80.8% de cobertura Sonar, 0.0% de duplicación, cero bugs, cero vulnerabilidades, cero code smells y cero security hotspots. No quedan hallazgos abiertos en Sonar.

Las puertas actuales son:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:postgres
```

`pnpm test:postgres` requiere una base temporal dedicada y las variables `DS_TEST_POSTGRES_ISOLATED=1` y `DS_TEST_DATABASE_URL`. No apunta a la base local de desarrollo ni a producción.

Al añadir una métrica de cobertura, fija primero su configuración y umbrales en los paquetes que la midan, registra la salida de una ejecución completa y distingue entre código medido y código excluido. La cobertura ayuda a localizar rutas sin pruebas; no demuestra por sí sola que los controles estén bien especificados.

`pnpm quality:sonar` sube los cinco informes LCOV a la instancia local descrita en [sonarqube-local.md](sonarqube-local.md). La puerta Sonar espera el Quality Gate configurado localmente. No se ha enviado código al servicio SonarQube Cloud ni a GitHub para este análisis.
