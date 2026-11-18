import { createHash, createPrivateKey, createPublicKey, randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { isIP } from "node:net";
import {
  createTechnicalJwtProvider,
  runInternalAudit,
  type InternalAuditRunResult,
  type InternalAuditFetcher,
  type InternalAuditRequest,
} from "@desarrolloseguro/core";

const AUDIT_ENABLED = "true";
const AUDIT_PRIVATE_KEY_FILE = "AUDIT_JWT_PRIVATE_KEY_FILE";
const AUDIT_ATTESTATION_KEY_FILE = "AUDIT_RELEASE_ATTESTATION_PUBLIC_KEY_FILE";
const AUDIT_KID = "AUDIT_TECHNICAL_AUTH_KID";
const ATTESTATION_KID = "AUDIT_RELEASE_ATTESTATION_KID";
const AUDIT_SCOPES = "AUDIT_SCOPES";
const EXPECTED_ISSUER = "desarrolloseguro-audit";
const EXPECTED_AUDIENCE = "grumphya-audit";
const SUBJECT = "desarrollo-seguro-audit";

const OPERATIONS = [
  { resource: "infrastructure_snapshot", method: "GET", hostname: "grumphya.com", path: "/audit/infrastructure" },
  { resource: "deployment_attestation", method: "GET", hostname: "grumphya.com", path: "/audit/deployment" },
  { resource: "dependency_inventory", method: "GET", hostname: "grumphya.com", path: "/audit/dependencies" },
  { resource: "synthetic_browser_flow", method: "GET", hostname: "grumphya.com", path: "/audit/auth" },
  { resource: "performance_observation", method: "GET", hostname: "grumphya.com", path: "/audit/quality" },
  { resource: "privacy_observation", method: "GET", hostname: "grumphya.com", path: "/audit/privacy" },
  { resource: "ai_observation", method: "GET", hostname: "grumphya.com", path: "/audit/ai" },
] as const;

const DEFAULT_SCOPES = [
  "infrastructure",
  "application",
  "authentication",
  "quality",
  "privacy",
  "ethics",
  "ai",
] as const;

export type InternalAuditRuntime = {
  request: InternalAuditRequest;
  operations: readonly (typeof OPERATIONS)[number][];
  run(signal?: AbortSignal): Promise<InternalAuditRunResult>;
};

export type InternalAuditRuntimeDependencies = {
  fetcher?: InternalAuditFetcher;
  clock?: () => Date;
  idFactory?: () => string;
};

export function createInternalAuditRuntime(
  environment: NodeJS.ProcessEnv,
  dependencies: InternalAuditRuntimeDependencies = {},
): InternalAuditRuntime {
  if (environment.AUDIT_ENABLED !== AUDIT_ENABLED) {
    throw new Error("internal_audit_disabled");
  }
  const privateKey = readEd25519PrivateKey(environment[AUDIT_PRIVATE_KEY_FILE]);
  const attestationKid = readKid(environment[ATTESTATION_KID]);
  const attestationKey = readEd25519PublicKey(environment[AUDIT_ATTESTATION_KEY_FILE]);
  const technicalKid = readKid(environment[AUDIT_KID]);
  validateAllowedKids(environment.AUDIT_TECHNICAL_AUTH_ALLOWED_KIDS, technicalKid);
  validateAllowedNetworks(environment.AUDIT_ALLOWED_NETWORKS);
  const scopes = parseScopes(environment[AUDIT_SCOPES]);
  const operations = OPERATIONS.filter(({ resource }) => scopesForOperation(resource).some((scope) => scopes.includes(scope)));
  const request: InternalAuditRequest = {
    policyVersion: "beta-d-0.1",
    hostname: "grumphya.com",
    environment: "production",
    auditor: "desarrollo-seguro",
    scopes,
    evidenceRetentionDays: 30,
  };
  const technicalJwt = createTechnicalJwtProvider({
    privateKey,
    kid: technicalKid,
    issuer: EXPECTED_ISSUER,
    audience: EXPECTED_AUDIENCE,
    subject: SUBJECT,
    hostname: "grumphya.com",
    environment: "production",
    scopes,
    clock: dependencies.clock,
    idFactory: dependencies.idFactory,
  });
  const fetcher = dependencies.fetcher ?? createAuditFetcher();
  return {
    request,
    operations,
    run: (signal) => runInternalAudit({
      request,
      auditRef: createAuditRef(),
      observedAt: (dependencies.clock ?? (() => new Date()))().toISOString(),
      operations,
      fetcher,
      auth: {
        technicalJwt,
        releaseAttestationPublicKeys: new Map([[attestationKid, attestationKey]]),
      },
      signal,
    }),
  };
}

function createAuditFetcher(): InternalAuditFetcher {
  return async (url, init) => {
    const response = await fetch(url, init);
    return {
      ok: response.ok,
      status: response.status,
      headers: { get: (name) => response.headers.get(name) },
      json: () => response.json(),
    };
  };
}

function readEd25519PrivateKey(path: string | undefined) {
  try {
    const pem = readRestrictedPem(path, "PRIVATE KEY");
    const key = createPrivateKey(pem);
    if (key.asymmetricKeyType !== "ed25519") throw new Error("invalid_key_type");
    return key;
  } catch {
    throw new Error("internal_audit_private_key_invalid");
  }
}

function readEd25519PublicKey(path: string | undefined) {
  try {
    const pem = readRestrictedPem(path, "PUBLIC KEY");
    const key = createPublicKey(pem);
    if (key.asymmetricKeyType !== "ed25519") throw new Error("invalid_key_type");
    return key;
  } catch {
    throw new Error("internal_audit_attestation_key_invalid");
  }
}

function readRestrictedPem(path: string | undefined, kind: "PRIVATE KEY" | "PUBLIC KEY"): string {
  if (!path || !path.startsWith("/")) throw new Error("internal_audit_key_file_invalid");
  try {
    const stats = statSync(path);
    const pem = readFileSync(path, "utf8").trim();
    if (
      !stats.isFile() ||
      (stats.mode & 0o077) !== 0 ||
      pem.length === 0 ||
      !pem.includes(`${kind}`) ||
      (kind === "PUBLIC KEY" && pem.includes("PRIVATE KEY"))
    ) {
      throw new Error("invalid_file");
    }
    return pem;
  } catch {
    throw new Error("internal_audit_key_file_invalid");
  }
}

function readKid(value: string | undefined): string {
  if (!value || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(value)) {
    throw new Error("internal_audit_kid_invalid");
  }
  return value;
}

function validateAllowedKids(value: string | undefined, activeKid: string): void {
  const kids = (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  if (kids.length === 0 || new Set(kids).size !== kids.length || !kids.includes(activeKid) || kids.some((kid) => !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(kid))) {
    throw new Error("internal_audit_kids_invalid");
  }
}

function validateAllowedNetworks(value: string | undefined): void {
  const networks = (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  if (networks.length === 0 || networks.some((network) => {
    const [address, prefix] = network.split("/");
    const family = isIP(address);
    const prefixLength = Number(prefix);
    return network === "0.0.0.0/0" || network === "::/0" || family === 0 || !Number.isInteger(prefixLength) || prefixLength < 1 || prefixLength > (family === 4 ? 32 : 128);
  })) {
    throw new Error("internal_audit_networks_invalid");
  }
}

function parseScopes(value: string | undefined): InternalAuditRequest["scopes"] {
  const values = (value ? value.split(",") : [...DEFAULT_SCOPES])
    .map((item) => item.trim())
    .filter(Boolean);
  if (values.length === 0 || new Set(values).size !== values.length) {
    throw new Error("internal_audit_scopes_invalid");
  }
  const allowed = new Set(DEFAULT_SCOPES);
  if (values.some((scope) => !allowed.has(scope as (typeof DEFAULT_SCOPES)[number]))) {
    throw new Error("internal_audit_scopes_invalid");
  }
  if (values.includes("ethics") && !values.includes("privacy")) {
    throw new Error("internal_audit_scopes_invalid");
  }
  return values as InternalAuditRequest["scopes"];
}

function scopesForOperation(
  resource: (typeof OPERATIONS)[number]["resource"],
): readonly InternalAuditRequest["scopes"][number][] {
  if (resource === "infrastructure_snapshot") return ["infrastructure"];
  if (resource === "deployment_attestation" || resource === "dependency_inventory") return ["application"];
  if (resource === "synthetic_browser_flow") return ["authentication"];
  if (resource === "performance_observation") return ["quality"];
  if (resource === "privacy_observation") return ["privacy"];
  return ["ai"];
}

function createAuditRef(): string {
  return `sha256:${createHash("sha256").update(randomUUID()).digest("hex")}`;
}
