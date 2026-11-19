import { randomUUID } from "node:crypto";
import { createPrivateKey, sign, type KeyLike } from "node:crypto";

const DEFAULT_TTL_SECONDS = 300;
const MAX_TTL_SECONDS = 300;
const BASE64URL = /^[A-Za-z0-9_-]+$/u;
export const INTERNAL_AUDIT_JWT_ISSUER = "desarrolloseguro-audit" as const;
export const INTERNAL_AUDIT_JWT_AUDIENCE = "grumphya-audit" as const;

export type TechnicalJwtOptions = {
  privateKey: KeyLike | string;
  kid: string;
  issuer: string;
  audience: string;
  subject: string;
  hostname: "grumphya.com";
  environment: "production";
  scopes: readonly string[];
  ttlSeconds?: number;
  clock?: () => Date;
  idFactory?: () => string;
};

export type TechnicalJwtProvider = () => string;

export function createTechnicalJwtProvider(options: TechnicalJwtOptions): TechnicalJwtProvider {
  return () => createTechnicalJwt(options);
}

export function createTechnicalJwt(options: TechnicalJwtOptions): string {
  validateOptions(options);
  const clock = options.clock ?? (() => new Date());
  const issuedAt = Math.floor(clock().getTime() / 1_000);
  const ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const header = {
    alg: "EdDSA",
    kid: options.kid,
    typ: "JWT",
  };
  const payload = {
    iss: options.issuer,
    sub: options.subject,
    aud: options.audience,
    iat: issuedAt,
    exp: issuedAt + ttlSeconds,
    jti: (options.idFactory ?? randomUUID)(),
    kid: options.kid,
    domain: options.hostname,
    hostname: options.hostname,
    environment: options.environment,
    scope: options.scopes.map((scope) => `audit:${scope}`).join(" "),
  };
  const encodedHeader = encodeJson(header);
  const encodedPayload = encodeJson(payload);
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const privateKey = typeof options.privateKey === "string"
    ? createPrivateKey(options.privateKey)
    : options.privateKey;
  const signature = sign(null, Buffer.from(signingInput), privateKey);
  return `${signingInput}.${signature.toString("base64url")}`;
}

function validateOptions(options: TechnicalJwtOptions): void {
  if (
    typeof options.kid !== "string" || !BASE64URL.test(options.kid) || options.kid.length > 64 ||
    options.issuer !== INTERNAL_AUDIT_JWT_ISSUER ||
    options.audience !== INTERNAL_AUDIT_JWT_AUDIENCE ||
    typeof options.subject !== "string" || options.subject.length === 0 || options.subject.length > 128 ||
    options.hostname !== "grumphya.com" ||
    options.environment !== "production" ||
    !Array.isArray(options.scopes) || options.scopes.length === 0 ||
    options.scopes.some((scope) => typeof scope !== "string" || !/^[a-z][a-z0-9:_-]{0,63}$/u.test(scope))
  ) {
    throw new Error("internal_audit_auth_config_invalid");
  }
  const ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > MAX_TTL_SECONDS) {
    throw new Error("internal_audit_auth_config_invalid");
  }
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
