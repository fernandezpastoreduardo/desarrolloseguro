export const POSTGRES_TEST_OPT_IN = "DS_TEST_POSTGRES_ISOLATED";
export const POSTGRES_TEST_OPT_IN_VALUE = "1";

export const SAFE_POSTGRES_TEST_DATABASE_PREFIX = "development_security_test_";
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

export function assertSafePostgresTestTarget(
  databaseUrl: string | undefined,
  optIn: string | undefined,
): URL {
  if (optIn !== POSTGRES_TEST_OPT_IN_VALUE) {
    throw new Error("DS_TEST_POSTGRES_ISOLATED_opt_in_required");
  }
  if (!databaseUrl) {
    throw new Error("DS_TEST_DATABASE_URL_required");
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    throw new Error("DS_TEST_DATABASE_URL_invalid");
  }

  const hostname = parsedUrl.hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  if (
    parsedUrl.protocol !== "postgres:" &&
    parsedUrl.protocol !== "postgresql:"
  ) {
    throw new Error("DS_TEST_DATABASE_URL_must_use_postgres");
  }
  if (!LOOPBACK_HOSTNAMES.has(hostname)) {
    throw new Error("DS_TEST_DATABASE_URL_must_use_loopback");
  }
  if (parsedUrl.searchParams.size > 0 || parsedUrl.hash.length > 0) {
    throw new Error("DS_TEST_DATABASE_URL_overrides_forbidden");
  }

  const databaseName = decodeURIComponent(parsedUrl.pathname.slice(1));
  if (!databaseName.startsWith(SAFE_POSTGRES_TEST_DATABASE_PREFIX)) {
    throw new Error("DS_TEST_DATABASE_URL_must_target_isolated_database");
  }

  return parsedUrl;
}

export function isSafePostgresTestTarget(
  databaseUrl: string | undefined,
  optIn: string | undefined,
): boolean {
  try {
    assertSafePostgresTestTarget(databaseUrl, optIn);
    return true;
  } catch {
    return false;
  }
}
