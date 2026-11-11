import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { REPORT_ID_PATTERN } from "../public-scan/public-scan.constants.js";

const AUTHORIZED_HOSTNAMES = new Set(["grumphya.com"]);
const AUTHORIZED_ORIGINS = new Set([
  "https://grumphya.com",
  "https://desarrolloseguro.org",
]);
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const BADGE_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const PUBLIC_API_ORIGIN = "https://desarrolloseguro.org";
const ISSUER_TOKEN_REQUIRED = "report_badge_issuer_token_required";
const REPORT_BADGE_NOT_FOUND = "report_badge_not_found";

export type BadgeRecord = {
  hostname: string;
  reportId: string;
  tokenHash: string;
  expiresAt: Date;
};

export type ReportBadgeStore = {
  issue(record: BadgeRecord): Promise<boolean>;
  verify(input: { hostname: string; reportId: string; tokenHash: string; at: Date }): Promise<boolean>;
  revoke(input: { hostname: string; reportId: string; tokenHash: string; at: Date }): Promise<boolean>;
};

export type ReportBadgeConfig = { issuerToken: string | undefined };

@Injectable()
export class ReportBadgeService {
  constructor(
    private readonly store: ReportBadgeStore,
    private readonly config: ReportBadgeConfig = { issuerToken: process.env.DS_BADGE_ISSUER_TOKEN },
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async issue(credential: unknown, hostname: unknown, reportId: unknown): Promise<{ hostname: string; reportId: string; token: string; verifyUrl: string; expiresAt: string }> {
    this.authorizeIssuer(credential);
    const identity = validateIdentity(hostname, reportId);
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(this.clock().getTime() + BADGE_LIFETIME_MS);
    const created = await this.store.issue({ ...identity, tokenHash: hashToken(token), expiresAt });
    if (!created) throw new NotFoundException(REPORT_BADGE_NOT_FOUND);
    return {
      ...identity,
      token,
      verifyUrl: `${PUBLIC_API_ORIGIN}/desarrollo-seguro/verificar.html#${new URLSearchParams({ token, hostname: identity.hostname, reportId: identity.reportId }).toString()}`,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async verify(token: unknown, hostname: unknown, reportId: unknown, origin: unknown, fetchSite: unknown): Promise<{ verified: true; hostname: string; reportId: string } | { verified: false }> {
    if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) return { verified: false };
    const isAuthorizedOrigin = typeof origin === "string" && AUTHORIZED_ORIGINS.has(origin);
    const isDirectSameOriginPage = origin === undefined && fetchSite === "same-origin";
    if (!isAuthorizedOrigin && !isDirectSameOriginPage) return { verified: false };
    let identity: { hostname: string; reportId: string };
    try { identity = validateIdentity(hostname, reportId); } catch { return { verified: false }; }
    const valid = await this.store.verify({ ...identity, tokenHash: hashToken(token), at: this.clock() });
    return valid ? { verified: true, ...identity } : { verified: false };
  }

  async revoke(credential: unknown, token: unknown, hostname: unknown, reportId: unknown): Promise<{ revoked: boolean }> {
    this.authorizeIssuer(credential);
    if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) throw new BadRequestException(REPORT_BADGE_NOT_FOUND);
    const identity = validateIdentity(hostname, reportId);
    const revoked = await this.store.revoke({ ...identity, tokenHash: hashToken(token), at: this.clock() });
    if (!revoked) throw new NotFoundException(REPORT_BADGE_NOT_FOUND);
    return { revoked: true };
  }

  private authorizeIssuer(credential: unknown): void {
    const expected = this.config.issuerToken;
    if (typeof expected !== "string" || expected.length < 32 || typeof credential !== "string") {
      throw new UnauthorizedException(ISSUER_TOKEN_REQUIRED);
    }
    const expectedDigest = createHash("sha256").update(expected).digest();
    const providedDigest = createHash("sha256").update(credential).digest();
    if (!timingSafeEqual(expectedDigest, providedDigest)) throw new UnauthorizedException(ISSUER_TOKEN_REQUIRED);
  }
}

function validateIdentity(hostname: unknown, reportId: unknown): { hostname: string; reportId: string } {
  if (typeof hostname !== "string" || !AUTHORIZED_HOSTNAMES.has(hostname) || typeof reportId !== "string" || !REPORT_ID_PATTERN.test(reportId)) {
    throw new BadRequestException(REPORT_BADGE_NOT_FOUND);
  }
  return { hostname, reportId };
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
