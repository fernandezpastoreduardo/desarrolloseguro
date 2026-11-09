const HTTPS_SCHEME = "https";
const HSTS_MINIMUM_SECONDS = 15_768_000;
const HEADER_NAME_HSTS = "strict-transport-security";
const HEADER_NAME_NOSNIFF = "x-content-type-options";
const HEADER_NAME_FRAME = "x-frame-options";
const HEADER_NAME_REFERRER = "referrer-policy";
const HEADER_NAME_CSP = "content-security-policy";
const SAFE_REFERRER_POLICIES = new Set([
  "no-referrer",
  "same-origin",
  "strict-origin",
  "strict-origin-when-cross-origin",
]);
const SAFE_FRAME_POLICIES = new Set(["'none'", "'self'"]);
const CSP_NONCE_SOURCE_PATTERN = /^'nonce-[a-z0-9+/_-]{22,}={0,2}'$/iu;
const CSP_SHA256_SOURCE_PATTERN = /^'sha256-[a-z0-9+/_-]{43}='$/iu;
const CSP_SHA384_SOURCE_PATTERN = /^'sha384-[a-z0-9+/_-]{64}'$/iu;
const CSP_SHA512_SOURCE_PATTERN = /^'sha512-[a-z0-9+/_-]{86}=='$/iu;
const HEADER_NAMES = [
  HEADER_NAME_HSTS,
  HEADER_NAME_NOSNIFF,
  HEADER_NAME_FRAME,
  HEADER_NAME_REFERRER,
  HEADER_NAME_CSP,
] as const;

export type SecurityHeaderEvidence = {
  hsts: boolean;
  nosniff: boolean;
  frameProtection: boolean;
  referrerPolicy: boolean;
  csp: boolean;
};

export type SecurityHeaderAssessment = {
  status: "pass" | "fail" | "unknown";
  evidence: SecurityHeaderEvidence | null;
};

export const SECURITY_HEADER_RUBRIC_VERSION = "security-headers-v1";

export function assessSecurityHeaders(
  headers: unknown,
  finalScheme: unknown,
): SecurityHeaderAssessment {
  try {
    return assessSecurityHeadersRecord(headers, finalScheme);
  } catch {
    return { status: "unknown", evidence: null };
  }
}

function assessSecurityHeadersRecord(
  headers: unknown,
  finalScheme: unknown,
): SecurityHeaderAssessment {
  if (finalScheme !== HTTPS_SCHEME || !isPlainRecord(headers)) {
    return { status: "unknown", evidence: null };
  }

  const headerValues = new Map(
    HEADER_NAMES.map((headerName) => [
      headerName,
      getHeaderValues(headers, headerName),
    ]),
  );
  if ([...headerValues.values()].some((values) => values === null)) {
    return { status: "unknown", evidence: null };
  }

  const evidence: SecurityHeaderEvidence = {
    hsts: hasStrongHsts(headerValues.get(HEADER_NAME_HSTS) ?? []),
    nosniff: hasNosniff(headerValues.get(HEADER_NAME_NOSNIFF) ?? []),
    frameProtection: hasFrameProtection(
      headerValues.get(HEADER_NAME_FRAME) ?? [],
      headerValues.get(HEADER_NAME_CSP) ?? [],
    ),
    referrerPolicy: hasSafeReferrerPolicy(
      headerValues.get(HEADER_NAME_REFERRER) ?? [],
    ),
    csp: hasStrictCsp(headerValues.get(HEADER_NAME_CSP) ?? []),
  };

  return {
    status: Object.values(evidence).every(Boolean) ? "pass" : "fail",
    evidence,
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function getHeaderValues(
  headers: Record<string, unknown>,
  requestedName: string,
): readonly string[] | null {
  const matchingValues = Object.entries(headers)
    .filter(([name]) => name.toLowerCase() === requestedName)
    .map(([, value]) => value);
  const values: string[] = [];

  for (const value of matchingValues) {
    const candidates = Array.isArray(value) ? value : [value];
    if (!candidates.every((candidate) => typeof candidate === "string")) {
      return null;
    }
    values.push(...candidates);
  }

  return values;
}

function hasStrongHsts(values: readonly string[]): boolean {
  if (values.length !== 1) return false;

  const directives = values[0]
    ?.split(";")
    .map((directive) => directive.trim())
    .filter(Boolean);
  if (!directives) return false;

  const maxAgeDirectives = directives.filter((directive) =>
    /^max-age\s*=/iu.test(directive),
  );
  if (maxAgeDirectives.length !== 1) return false;

  const maxAgeMatch = /^max-age\s*=\s*(\d+)$/iu.exec(maxAgeDirectives[0] ?? "");
  if (!maxAgeMatch?.[1]) return false;

  const maxAgeSeconds = Number(maxAgeMatch[1]);
  return (
    Number.isSafeInteger(maxAgeSeconds) && maxAgeSeconds >= HSTS_MINIMUM_SECONDS
  );
}

function hasNosniff(values: readonly string[]): boolean {
  return values.length === 1 && values[0]?.trim().toLowerCase() === "nosniff";
}

function hasFrameProtection(
  frameValues: readonly string[],
  contentSecurityPolicies: readonly string[],
): boolean {
  const frameHeaderIsProtected =
    frameValues.length === 1 &&
    ["deny", "sameorigin"].includes(frameValues[0]?.trim().toLowerCase() ?? "");

  return (
    frameHeaderIsProtected ||
    contentSecurityPolicies.some((policy) =>
      hasRestrictedDirective(policy, "frame-ancestors", SAFE_FRAME_POLICIES),
    )
  );
}

function hasSafeReferrerPolicy(values: readonly string[]): boolean {
  if (values.length === 0) return false;

  const directives = values.flatMap((value) => value.split(","));
  return (
    directives.length > 0 &&
    directives.every((directive) =>
      SAFE_REFERRER_POLICIES.has(directive.trim().toLowerCase()),
    )
  );
}

function hasStrictCsp(values: readonly string[]): boolean {
  return values.some((policy) => {
    const directives = parseCspDirectives(policy);
    return (
      hasOnlySource(directives.get("default-src"), ["'self'", "'none'"]) &&
      hasOnlySource(directives.get("object-src"), ["'none'"]) &&
      hasOnlySource(directives.get("base-uri"), ["'self'", "'none'"]) &&
      hasOnlySource(directives.get("frame-ancestors"), [
        ...SAFE_FRAME_POLICIES,
      ]) &&
      hasOnlySource(directives.get("form-action"), ["'self'", "'none'"]) &&
      hasStrictScriptSources(directives.get("script-src"))
    );
  });
}

function hasRestrictedDirective(
  policy: string,
  directiveName: string,
  allowedValues: ReadonlySet<string>,
): boolean {
  return hasOnlySource(parseCspDirectives(policy).get(directiveName), [
    ...allowedValues,
  ]);
}

function hasOnlySource(
  sources: readonly string[] | undefined,
  allowedSources: readonly string[],
): boolean {
  return (
    sources !== undefined &&
    sources.length === 1 &&
    allowedSources.includes(sources[0]?.toLowerCase() ?? "")
  );
}

function hasStrictScriptSources(
  sources: readonly string[] | undefined,
): boolean {
  if (!sources || sources.length === 0) return false;

  const containsNonceOrHash = sources.some((source) =>
    isStrictCspScriptSource(source),
  );
  const containsOnlyStrictSources = sources.every(
    (source) =>
      isStrictCspScriptSource(source) ||
      source.toLowerCase() === "'strict-dynamic'",
  );

  return containsNonceOrHash && containsOnlyStrictSources;
}

function isStrictCspScriptSource(source: string): boolean {
  return (
    CSP_NONCE_SOURCE_PATTERN.test(source) ||
    CSP_SHA256_SOURCE_PATTERN.test(source) ||
    CSP_SHA384_SOURCE_PATTERN.test(source) ||
    CSP_SHA512_SOURCE_PATTERN.test(source)
  );
}

function parseCspDirectives(policy: string): Map<string, readonly string[]> {
  const directives = new Map<string, readonly string[]>();

  for (const item of policy.split(";")) {
    const [rawName, ...sources] = item.trim().split(/\s+/u);
    if (!rawName) continue;

    const directiveName = rawName.toLowerCase();
    if (
      /^[a-z][a-z0-9-]*$/u.test(directiveName) &&
      !directives.has(directiveName)
    ) {
      directives.set(directiveName, sources);
    }
  }

  return directives;
}
