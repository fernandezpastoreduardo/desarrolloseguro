import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { normalizeHostname } from "@desarrolloseguro/core";
import {
  PublicScanRateLimiter,
  publicScanRateLimitErrors,
} from "./public-scan-rate-limiter.js";
import { REPORT_ID_PATTERN } from "./public-scan.constants.js";

const UNKNOWN_CLIENT_IP = "unknown";
const CACHE_CONTROL_HEADER = "Cache-Control";
const CACHE_CONTROL_NO_STORE = "no-store";
const RETRY_AFTER_HEADER = "Retry-After";
const RATE_LIMIT_CAPACITY_REACHED = "development_security_capacity_reached";
const RATE_LIMITED = "rate_limited";
type RequestContext = {
  ip?: unknown;
  socket?: { remoteAddress?: unknown };
  params?: Record<string, unknown>;
};

type ResponseContext = {
  setHeader?: (name: string, value: string) => unknown;
};

@Injectable()
export class PublicScanRateLimitGuard implements CanActivate {
  constructor(private readonly limiter: PublicScanRateLimiter) {}

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const request = http.getRequest<RequestContext>();
    const response = http.getResponse<ResponseContext>();
    response.setHeader?.(CACHE_CONTROL_HEADER, CACHE_CONTROL_NO_STORE);
    const decision = this.limiter.consume({
      clientIp: resolveClientIp(request),
      hostname: resolveRequestedHostname(request.params?.hostname),
      reportId: resolveRequestedReportId(request.params?.reportId),
    });

    if (decision.allowed) return true;
    if (decision.kind === publicScanRateLimitErrors.capacityReached) {
      throw new ServiceUnavailableException(RATE_LIMIT_CAPACITY_REACHED);
    }

    response.setHeader?.(
      RETRY_AFTER_HEADER,
      String(decision.retryAfterSeconds),
    );
    throw new HttpException(RATE_LIMITED, HttpStatus.TOO_MANY_REQUESTS);
  }
}

function resolveClientIp(request: RequestContext): string {
  if (typeof request.ip === "string" && request.ip.trim() !== "") {
    return request.ip;
  }
  if (
    typeof request.socket?.remoteAddress === "string" &&
    request.socket.remoteAddress.trim() !== ""
  ) {
    return request.socket.remoteAddress;
  }
  return UNKNOWN_CLIENT_IP;
}

function resolveRequestedHostname(input: unknown): string | null {
  try {
    return normalizeHostname(input);
  } catch {
    return null;
  }
}

function resolveRequestedReportId(input: unknown): string | null {
  return typeof input === "string" && REPORT_ID_PATTERN.test(input)
    ? input.toLowerCase()
    : null;
}
