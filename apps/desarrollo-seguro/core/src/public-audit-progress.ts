export const PUBLIC_AUDIT_PROGRESS_VERSION = "public-audit-progress-v1" as const;
export const PUBLIC_AUDIT_ASPECTS = [
  "ethics",
  "privacy",
  "security",
  "performance",
] as const;
export type PublicAuditAspect = (typeof PUBLIC_AUDIT_ASPECTS)[number];
export const PUBLIC_AUDIT_PROGRESS_STATES = ["pending", "running", "complete"] as const;
export type PublicAuditProgressState = (typeof PUBLIC_AUDIT_PROGRESS_STATES)[number];

export type PublicAuditProgress = {
  policyVersion: typeof PUBLIC_AUDIT_PROGRESS_VERSION;
  aspects: Record<PublicAuditAspect, PublicAuditProgressState>;
};

export type PublicAuditProgressEvent = {
  aspect: PublicAuditAspect;
  state: Exclude<PublicAuditProgressState, "pending">;
};

export function createInitialPublicAuditProgress(): PublicAuditProgress {
  return {
    policyVersion: PUBLIC_AUDIT_PROGRESS_VERSION,
    aspects: {
      ethics: "pending",
      privacy: "pending",
      security: "pending",
      performance: "pending",
    },
  };
}

export function parsePublicAuditProgress(value: unknown): PublicAuditProgress | null {
  if (!isRecord(value) || Object.keys(value).length !== 2 ||
      value.policyVersion !== PUBLIC_AUDIT_PROGRESS_VERSION || !isRecord(value.aspects)) return null;
  const aspects = value.aspects;
  if (Object.keys(aspects).length !== PUBLIC_AUDIT_ASPECTS.length ||
      !PUBLIC_AUDIT_ASPECTS.every((aspect) =>
        Object.hasOwn(aspects, aspect) && isProgressState(aspects[aspect]),
      )) return null;
  return {
    policyVersion: PUBLIC_AUDIT_PROGRESS_VERSION,
    aspects: {
      ethics: aspects.ethics as PublicAuditProgressState,
      privacy: aspects.privacy as PublicAuditProgressState,
      security: aspects.security as PublicAuditProgressState,
      performance: aspects.performance as PublicAuditProgressState,
    },
  };
}

export function parsePublicAuditProgressEvent(value: unknown): PublicAuditProgressEvent | null {
  if (!isRecord(value) || Object.keys(value).length !== 2 ||
      !PUBLIC_AUDIT_ASPECTS.includes(value.aspect as PublicAuditAspect) ||
      value.state !== "running" && value.state !== "complete") return null;
  return { aspect: value.aspect as PublicAuditAspect, state: value.state };
}

export function advancePublicAuditProgress(
  current: PublicAuditProgress,
  event: PublicAuditProgressEvent,
): PublicAuditProgress | null {
  const previous = current.aspects[event.aspect];
  if (previous === "complete" && event.state !== "complete") return null;
  if (previous === "pending" && event.state !== "running" && event.state !== "complete") return null;
  if (previous === "running" && event.state === "running") return current;
  return {
    ...current,
    aspects: { ...current.aspects, [event.aspect]: event.state },
  };
}

function isProgressState(value: unknown): value is PublicAuditProgressState {
  return typeof value === "string" && PUBLIC_AUDIT_PROGRESS_STATES.includes(value as PublicAuditProgressState);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
