# DTOs y API pública

Los DTOs son contratos HTTP. No exponen filas SQL, `evidence_json`, `lease_token`, métricas internas ni mensajes de error de PostgreSQL.

## Rutas disponibles

- `GET /api/desarrollo-seguro/v1/domains/:hostname/status`
- `GET /api/desarrollo-seguro/v1/reports/:reportId`

Ambas rutas son de solo lectura, aplican `Cache-Control: no-store` y un limitador por proceso. La API normaliza el hostname; un hostname inválido da 400. Un UUID mal formado o un informe inexistente da 404. Si la persistencia falla, responde con un error público genérico y registra solo un código seguro.

## Estado del dominio

```ts
type PublicDomainState =
  | "fresh"
  | "updating"
  | "stale"
  | "not_scanned"
  | "unavailable";

type PublicDomainStatus = {
  hostname: string;
  enrollment: "monitored" | "on_demand";
  state: PublicDomainState;
  activeJobId: string | null;
  lastReport: PublicReport | null;
  checkedAt: string;
};
```

El endpoint no crea trabajos ni resuelve el hostname. Sin snapshot devuelve `on_demand`, `not_scanned` y `lastReport: null`.

## Informe público

```ts
type PublicReport = {
  id: string;
  hostname: string;
  profileVersion: string;
  scannerVersion: string;
  vantage: "same_vps";
  trigger: "scheduled" | "requested";
  startedAt: string;
  completedAt: string;
  expiresAt: string;
  verdict: "pass" | "fail" | "inconclusive";
  scope: string[];
  checks: Array<{
    controlId: string;
    status: "pass" | "fail" | "unknown" | "not_applicable";
    required: boolean;
    severity: string;
    observedAt: string;
    targetPath: string;
    method: string;
    summary: string;
    limitation: string;
  }>;
};
```

`same_vps` identifica la ubicación de observación y no significa evaluación independiente. Las rutas y métodos publicados proceden del perfil, no de parámetros de la petición. El informe no existe todavía si no hay una ejecución completa previa.

## Capacidad futura

No hay endpoint de admisión de escaneo, búsqueda de hostname con ejecución ni scheduler en servicio. Antes de añadirlos, definir DTOs versionados, validación por allowlist, cuotas en almacenamiento compartido, idempotencia y límites de red en [features.md](features.md) y [scanner-safety.md](scanner-safety.md). No reutilizar contratos de una aplicación anterior.
