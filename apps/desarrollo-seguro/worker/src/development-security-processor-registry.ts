import type { ProcessorDisclosure } from "@desarrolloseguro/core";

/** Production providers that host or process Desarrollo Seguro service data. */
export const DEVELOPMENT_SECURITY_PROCESSOR_REGISTRY = {
  revision: "v2",
  processors: [{
    providerId: "ionos",
    displayName: "IONOS",
    product: "VPS",
    disclosureStatus: "published",
    purpose: "Alojamiento de la web pública, la API y la base de datos de Desarrollo Seguro.",
    policyUrl: "https://desarrolloseguro.org/desarrollo-seguro/privacidad.html#ionos-hosting",
    declaredStatements: [
      "Desarrollo Seguro está alojado en un VPS de IONOS que ejecuta la web pública, la API y la base de datos.",
    ],
  }] satisfies ProcessorDisclosure[],
} as const;
