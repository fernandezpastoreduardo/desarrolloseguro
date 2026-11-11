# Verificación y cobertura

La cobertura Vitest de la última ejecución se midió con `pnpm test:coverage` el 10 de noviembre de 2026. Son porcentajes de líneas por paquete; `persistence` y `worker` tienen suites PostgreSQL aisladas que no entran en esta ejecución de Vitest normal.

| Paquete | Líneas cubiertas |
| --- | ---: |
| core | 99.62% |
| web | 91.41% |
| persistence | 59.75% |
| api | 95.37% |
| worker | 84.90% |

El agregado ponderado observado fue aproximadamente 83.4% de líneas. Los resultados son un punto de partida, no un objetivo ni una prueba de suficiencia funcional. `persistence` continúa siendo el principal hueco; antes de elevar umbrales globales se revisarán rutas críticas y los tests PostgreSQL.

El primer análisis SonarQube local se completó el 10 de noviembre de 2026. La Quality Gate quedó `PASSED`; inicialmente registró 80.5% de cobertura Sonar, 0.0% de duplicación, 4 bugs, 1 vulnerabilidad, 18 code smells y 0 security hotspots. La cobertura de Sonar usa su propio modelo de líneas y no coincide necesariamente con el agregado ponderado de Vitest.

El backlog inicial se revisó y corrigió siguiendo TDD. La clave de test ya no está versionada: se genera con OpenSSL desde `/usr/bin/openssl` dentro de un temporal privado, y una prueba verifica que `PATH` no pueda sustituir el ejecutable. Se corrigió la comparación del fixture del protocolo y se hizo explícito el encadenamiento de promesas del coordinador. Las alertas sobre CIDR de direcciones reservadas y el `try` síncrono del limitador DNS se documentaron en su línea porque esos literales son necesarios para bloquear respuestas no públicas y la promesa ya se gestiona después del `try`.

El análisis local del 10 de noviembre de 2026 tras añadir el adaptador de telemetría y el runner Docker efímero registró Quality Gate `PASSED`, 81.3% de cobertura Sonar, 89.0% de cobertura nueva, 0.0% de duplicación y cero hallazgos abiertos. Tras conectar el entrypoint del worker y la recuperación periódica de leases, el Quality Gate siguió en `PASSED`; la cobertura Sonar fue 81.2%, con cero bugs, vulnerabilidades, code smells, security hotspots y hallazgos abiertos. La cobertura Vitest del worker fue 84.74%.

La ejecución posterior del 10 de noviembre de 2026, con aprovisionamiento de `ds_worker` y TLS verificado en su configuración, pasó la Quality Gate. La siguiente ejecución, al añadir scheduler y rol `ds_retention`, también quedó `PASSED`: Sonar informó 81.3% de cobertura, 0.7% de duplicación y cero bugs, vulnerabilidades, code smells, security hotspots y hallazgos abiertos. La cobertura Vitest por paquete fue 99.62% en core, 91.41% en web, 59.75% en persistence, 95.37% en API y 84.90% en worker. Las suites PostgreSQL aisladas pasan aparte; 71 pruebas que necesitan base dedicada se omiten en `pnpm test`.

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

Las pruebas de navegador usan Playwright Test 1.65.0 con Chromium y se ejecutan con `pnpm test:e2e`. La configuración arranca Vite en loopback y prueba la portada sin backend ni solicitudes externas. CI instala el navegador y ejecuta este smoke test como una puerta aparte; para uso local, instala Chromium una vez con `pnpm --filter @desarrolloseguro/web exec playwright install chromium`.

En la iteración de admisión compartida, las nuevas pruebas PostgreSQL fallaron primero al mostrar que doce dominios podían encolar sin límite y que una segunda petición al mismo dominio podía crear otro trabajo. Tras las migraciones 010/011, `pnpm test:postgres` pasó desde una base limpia: 83 pruebas de persistencia/provisión y 1 prueba worker. Se comprobaron diez trabajos en espera, una ejecución global, una admisión por hostname cada 24 horas, alta transaccional `on_demand`, exclusión de opt-out, máximo de 1000 dominios y permisos de función. La API pasó 100 pruebas, web 16 y Playwright 2; el flujo visual usa la API simulada, sin tráfico externo. Esto prepara la experiencia de solicitud, pero no habilita análisis remoto ni justifica desplegar el worker.

El 11 de noviembre de 2026, `pnpm quality:check`, `pnpm test:e2e`, `pnpm test:postgres` desde esquema vacío y `pnpm quality:sonar` finalizaron correctamente; la Quality Gate local de Sonar quedó `PASSED`. El proceso de análisis mantiene el hostname fuera de perfiles seleccionables por cliente y solo devuelve el estado público de admisión.
