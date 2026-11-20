import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const ISOLATED_OPT_IN = "DS_TEST_POSTGRES_ISOLATED";
const DATABASE_URL = "DS_TEST_DATABASE_URL";

export function validatePostgresTestEnvironment(environment) {
  if (environment[ISOLATED_OPT_IN] !== "1") {
    throw new Error("postgres_test_isolation_opt_in_required");
  }

  const value = environment[DATABASE_URL];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("postgres_test_database_url_required");
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("postgres_test_database_url_invalid");
  }

  if (!new Set(["postgres:", "postgresql:"]).has(url.protocol)) {
    throw new Error("postgres_test_database_url_scheme_invalid");
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error("postgres_test_database_url_host_invalid");
  }
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (!databaseName.includes("test")) {
    throw new Error("postgres_test_database_name_invalid");
  }
  return true;
}

function run() {
  try {
    validatePostgresTestEnvironment(process.env);
    process.stdout.write("postgres_test_environment_ready\n");
  } catch (error) {
    const code = error instanceof Error && /^[a-z0-9_]+$/u.test(error.message)
      ? error.message
      : "postgres_test_environment_invalid";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  run();
}
