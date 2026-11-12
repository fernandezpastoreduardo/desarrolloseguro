# DTOs y API pública

Los DTOs son contratos HTTP. No exponen filas SQL, `evidence_json`, `lease_token`, métricas internas ni mensajes de error de PostgreSQL.

## Rutas disponibles

- `GET /api/desarrollo-seguro/v1/domains/:hostname/status`
- `GET /api/desarrollo-seguro/v1/reports/:reportId`
- `POST /api/desarrollo-seguro/v1/domains/:hostname/analysis-requests`

Ambas rutas son de solo lectura, aplican `Cache-Control: no-store` y un limitador por proceso. La API normaliza el hostname; un hostname inválido da 400. Un UUID mal formado o un informe inexistente da 404. Si la persistencia falla, responde con un error público genérico y registra solo un código seguro.

La ruta `POST` también aplica `Cache-Control: no-store`, limitador por proceso y hostname normalizado. Solo acepta `{ "authorized": true }`; no acepta perfil, rutas, métodos ni destinos en el body. Responde 202 con `{ hostname, state }`, donde `state` es `queued`, `running`, `cached`, `rate_limited`, `capacity_reached` o `unavailable`. El cliente no recibe IDs internos del trabajo. Los nuevos dominios reciben `domain-v1`; la migración 015 actualiza a ese perfil los registros existentes que aún usaban `transport-v1`, sin modificar sus informes históricos. Se mantiene un máximo de 1000 dominios on-demand registrados y 10 trabajos en espera. Durante la fase de pruebas no aplica el intervalo de 24 horas ni reutiliza informes recientes como resultado de una nueva solicitud; ambos límites se reactivarán antes de producción. Se conservan el límite de cola, la ejecución única y el limitador de API por proceso. La API no puede insertar directamente en las tablas. La respuesta `queued` confirma que se registró la petición, no que el worker esté operativo ni que haya conectado con el dominio.

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
  ethicsAssessment: {
    policyVersion: "domain-ethics-v3";
    score: number | null;
    assessedCriteria: number;
    totalCriteria: number;
    maturity: "preliminary" | "partial" | "broad";
    criteria: Array<{
      id: string;
      label: string;
      status: "pass" | "fail" | "unknown";
      weight: number;
    }>;
    reasons: string[];
    interpretation: string;
  };
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
    evidence: Record<string, string | number | boolean>;
  }>;
};
```

El resumen se calcula en la API desde los controles del mismo informe y agrupa criterios en Ética, Privacidad, Seguridad y Rendimiento. Cada categoría muestra cobertura, estado y explicación. Las evidencias públicas se limitan a una allowlist de datos agregados (por ejemplo, protocolo TLS, estado HTTP, señales de cabeceras y recuentos de cookies); se excluyen direcciones IP, nombres/valores de cookies, contenido de página y trazas. `domain-v1` solo observa cookies de la respuesta inicial; el consentimiento tras elegir, rastreo dinámico, mapas de calor, rendimiento y reutilización/venta de datos permanecen `unknown`. Véase [domain-ethics-scoring.md](domain-ethics-scoring.md).

`same_vps` identifica la ubicación de observación y no significa evaluación independiente. Las rutas y métodos publicados proceden del perfil, no de parámetros de la petición. El informe no existe todavía si no hay una ejecución completa previa.

## Límites operativos

La solicitud pública ya está conectada a la primitiva compartida, pero worker, supervisor y executor siguen fuera de Compose y el runner local usa `network none`. La ruta solo encola; no se ha habilitado tráfico hacia dominios. Antes de activar el worker deben cerrarse las pruebas de egress con servicios señuelo, revisar límites de carga/privacidad y probar backup/restauración según [scanner-safety.md](scanner-safety.md).
