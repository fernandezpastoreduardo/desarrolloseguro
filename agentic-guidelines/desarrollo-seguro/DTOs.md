# DTOs y API pública

Los DTOs son contratos HTTP. No exponen filas SQL, `evidence_json`, `lease_token`, métricas internas ni mensajes de error de PostgreSQL.

## Rutas disponibles

- `GET /api/desarrollo-seguro/v1/domains/:hostname/status`
- `GET /api/desarrollo-seguro/v1/reports/:reportId`
- `POST /api/desarrollo-seguro/v1/domains/:hostname/analysis-requests`

Ambas rutas son de solo lectura, aplican `Cache-Control: no-store` y un limitador por proceso. La API normaliza el hostname; un hostname inválido da 400. Un UUID mal formado o un informe inexistente da 404. Si la persistencia falla, responde con un error público genérico y registra solo un código seguro.

El estado puede recibir `?targetUrl=https%3A...`; cuando se proporciona, solo devuelve un informe cuyo alcance corresponde a esa URL. El `POST` acepta `{ "authorized": true, "targetUrl": "https://..." }`; exige HTTPS, hostname público coincidente, sin credenciales, sin puerto alternativo y elimina el fragmento. El análisis usa exactamente la ruta y query en todos sus bloques. Responde 202 con `{ hostname, targetUrl, state }`, donde `state` es `queued`, `running`, `cached`, `rate_limited`, `capacity_reached` o `unavailable`; no expone IDs internos.

Los informes nuevos usan `domain-v5`. Conservan la ruta y query dentro de `scope`, que forma parte del informe público. La URL se conserva también en la cola PostgreSQL hasta que el trabajo termina; se elimina al completar, fallar definitivamente o agotar intentos. La consulta de estado es de solo lectura y no resuelve el destino ni crea trabajos. La admisión aplica el limitador de API por proceso, el cooldown de 24 horas por hostname y un único análisis solicitado activo por hostname; la deduplicación exacta reutiliza el mismo trabajo y una URL distinta activa queda limitada. Se conserva el máximo de 1000 dominios `on_demand` y 10 trabajos en espera. La respuesta `queued` confirma que se registró la petición, no que el worker esté operativo ni que haya conectado con el dominio.

`domain-v5` ejecuta las comprobaciones de la URL seleccionada e incluye mediciones de Chromium en móvil y escritorio: FCP, LCP, CLS, TBT, TTFB y bytes transferidos. La nota usa la rúbrica propia documentada en [`auditoria-url-y-rendimiento.md`](../../doc/auditoria-url-y-rendimiento.md); no es la puntuación oficial de Lighthouse. Si falta una métrica requerida, la categoría queda sin puntuación.

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

El resumen se calcula en la API desde los controles del mismo informe y agrupa criterios en Ética, Privacidad, Seguridad y Rendimiento. Cada categoría muestra cobertura, estado y explicación. Las evidencias públicas se limitan a una allowlist de datos agregados (por ejemplo, protocolo TLS, estado HTTP, señales de cabeceras, recuentos de cookies y referencias/respuesta iniciales); se excluyen direcciones IP, nombres/valores de cookies, contenido de página y trazas. No se comprueba el consentimiento interactivo, rastreo dinámico, mapas de calor ni reutilización/venta de datos. Véase [domain-ethics-scoring.md](domain-ethics-scoring.md).

`same_vps` identifica la ubicación de observación y no significa evaluación independiente. Las rutas y métodos publicados proceden del perfil, no de parámetros de la petición. El informe no existe todavía si no hay una ejecución completa previa.

## Límites operativos

La solicitud pública ya está conectada a la primitiva compartida. Worker y coordinador operan en Compose; el executor y el broker se crean efímeramente por trabajo y el runner local usa `network none`. La ruta solo encola; el tráfico hacia dominios se limita a la red de egress autorizada. Antes de ampliar controles deben mantenerse las pruebas de egress con servicios señuelo, revisar límites de carga/privacidad y probar backup/restauración según [scanner-safety.md](scanner-safety.md).
