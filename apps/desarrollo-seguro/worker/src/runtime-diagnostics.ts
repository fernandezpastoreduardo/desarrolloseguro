import { isNetworkProbeFailureList, type NetworkProbeFailure } from "./transport-v1-executor.js";
import {
  SCAN_FAILURE_DIAGNOSTIC_CODES,
  SCAN_FAILURE_DIAGNOSTIC_STAGES,
  parseScanFailureDiagnostic,
  type ScanFailureDiagnostic,
} from "@desarrolloseguro/core";

export const RUNTIME_DIAGNOSTIC_STAGES = SCAN_FAILURE_DIAGNOSTIC_STAGES;

export const RUNTIME_DIAGNOSTIC_CODES = SCAN_FAILURE_DIAGNOSTIC_CODES;

export type RuntimeDiagnosticStage = (typeof RUNTIME_DIAGNOSTIC_STAGES)[number];
export type RuntimeDiagnosticCode = (typeof RUNTIME_DIAGNOSTIC_CODES)[number];

export type RuntimeDiagnosticEvent = {
  type: "runtime_diagnostic";
  stage: RuntimeDiagnosticStage;
  code: RuntimeDiagnosticCode;
  attempt?: number;
  causeCode?: RuntimeDiagnosticCode;
  probeFailures?: NetworkProbeFailure[];
};

export type RuntimeDiagnosticWriter = (event: RuntimeDiagnosticEvent) => void;
export type RuntimeDiagnosticSink = (line: string) => void;

export function readScanFailureDiagnostic(error: unknown): ScanFailureDiagnostic | null {
  if (!(error instanceof Error) || !("scanFailureDiagnostic" in error)) return null;
  const value: unknown = error.scanFailureDiagnostic;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return parseScanFailureDiagnostic(value);
}

export function attachScanFailureDiagnostic<T extends Error>(
  error: T,
  diagnostic: RuntimeDiagnosticEvent | null | undefined,
): T {
  if (diagnostic && isSafeRuntimeDiagnosticEvent(diagnostic)) {
    Object.defineProperty(error, "scanFailureDiagnostic", {
      value: toScanFailureDiagnostic(diagnostic),
      enumerable: false,
    });
  }
  return error;
}

export function toScanFailureDiagnostic(event: RuntimeDiagnosticEvent): ScanFailureDiagnostic {
  return {
    stage: event.stage,
    code: event.code,
    ...(event.probeFailures ? { probeFailures: event.probeFailures } : {}),
  };
}

/** Writes only allowlisted operational categories, never request or error payloads. */
export function createJsonLineRuntimeDiagnostic(
  write: RuntimeDiagnosticSink = (line) => process.stderr.write(line),
): RuntimeDiagnosticWriter {
  return (event) => {
    if (!isSafeRuntimeDiagnosticEvent(event)) return;
    try {
      const safeEvent: RuntimeDiagnosticEvent = {
        type: event.type,
        stage: event.stage,
        code: event.code,
        ...(event.attempt === undefined ? {} : { attempt: event.attempt }),
        ...(event.causeCode === undefined ? {} : { causeCode: event.causeCode }),
        ...(event.probeFailures === undefined ? {} : { probeFailures: event.probeFailures }),
      };
      write(`${JSON.stringify(safeEvent)}\n`);
    } catch {
      // Diagnostics must never change scan execution or cleanup behavior.
    }
  };
}

function isSafeRuntimeDiagnosticEvent(event: RuntimeDiagnosticEvent): boolean {
  return (
    event.type === "runtime_diagnostic" &&
    RUNTIME_DIAGNOSTIC_STAGES.includes(event.stage) &&
    RUNTIME_DIAGNOSTIC_CODES.includes(event.code) &&
    (event.causeCode === undefined || RUNTIME_DIAGNOSTIC_CODES.includes(event.causeCode)) &&
    (event.probeFailures === undefined || isNetworkProbeFailureList(event.probeFailures)) &&
    (event.attempt === undefined || (
      Number.isSafeInteger(event.attempt) && event.attempt >= 1 && event.attempt <= 3
    ))
  );
}
