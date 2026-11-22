import type { ProcessorDisclosure } from "@desarrolloseguro/core";

/** Backend integrations that receive user reports or analysis data. */
export const DEVELOPMENT_SECURITY_PROCESSOR_REGISTRY = {
  revision: "v1",
  processors: [] as ProcessorDisclosure[],
} as const;
