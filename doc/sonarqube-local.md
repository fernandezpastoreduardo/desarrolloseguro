# SonarQube Community Build local

Esta instancia sirve para analizar el repositorio en el equipo de desarrollo. No forma parte de la aplicación pública, de la pila del VPS ni de GitHub Actions. El código fuente y los informes de cobertura se envían únicamente al SonarQube local en `127.0.0.1`.

## Privacidad y aislamiento

- SonarQube Community Build 26.10.0.133078 usa una base PostgreSQL dedicada, con volumen propio y sin puerto publicado.
- La UI solo se publica en `127.0.0.1:9000`. PostgreSQL y SonarQube comparten una red interna; la interfaz local usa una red bridge adicional sin IP masquerading para no dar salida NAT a los contenedores.
- `SONAR_TELEMETRY_ENABLE=false` desactiva la telemetría del servidor. La imagen de SonarQube y la de PostgreSQL se descargan desde Docker Hub al preparar o actualizar el servicio, pero esos pasos no les envían el código fuente.
- El frontend público no integra SonarQube, analítica ni recursos de terceros. El navegador visita una instancia local de mismo origen; esto no cambia las cookies ni la política de privacidad de `desarrolloseguro.org`.
- El token de análisis no se guarda en Git ni en `sonar-project.properties`; se pasa mediante `SONAR_TOKEN` al proceso local.

## Arranque

Requiere Docker Desktop/Engine con recursos suficientes para SonarQube Community Build. SonarSource recomienda al menos 4 GB de RAM para una instancia pequeña.

```sh
cp .env.sonar.local.example .env.sonar.local
```

En el primer arranque, inicia el servicio y cambia la contraseña inicial `admin` en la UI. Crea el proyecto `Desarrollo Seguro` con clave `desarrollo-seguro` y genera un token de análisis limitado a ese proyecto. Guarda la contraseña administrativa y el token junto a la contraseña aleatoria de PostgreSQL en `.env.sonar.local`. El archivo está ignorado por Git; no lo añadas al repositorio.

```sh
docker compose --env-file .env.sonar.local -f compose.sonarqube.local.yaml up -d
```

Espera a que `http://127.0.0.1:9000/api/system/status` informe que el servicio está operativo. El ejemplo incluye nombres para los tres secretos; reemplaza todos sus valores. Para entrar como administrador, consulta la contraseña guardada localmente. El token debe tener alcance de análisis del proyecto.

## Analizar

Ejecuta el análisis. El comando genera informes LCOV de Vitest, lee el token desde `.env.sonar.local` sin mostrarlo y sube el análisis al servidor local.

```sh
pnpm quality:sonar
```

Repite el escaneo cuando quieras comparar la calidad del código. SonarQube Community Build local ofrece análisis de la rama principal; el workflow remoto mantiene sus puertas de lint, tipos, pruebas, build, integración y auditoría, sin intentar conectarse a la instancia local.

## Parada y datos

```sh
docker compose --env-file .env.sonar.local -f compose.sonarqube.local.yaml down
```

Esto detiene los contenedores y conserva los volúmenes. Para borrar intencionalmente el histórico local y la base de datos, usa `down --volumes`; no lo ejecutes durante una parada normal.
