import assert from "node:assert/strict";
import { test } from "node:test";
import { validatePostgresTestEnvironment } from "./require-postgres-test-env.mjs";

const valid = {
  DS_TEST_POSTGRES_ISOLATED: "1",
  DS_TEST_DATABASE_URL:
    "postgresql://postgres:password@127.0.0.1:5432/development_security_test_admin",
};

test("accepts an explicitly isolated loopback test database", () => {
  assert.equal(validatePostgresTestEnvironment(valid), true);
});

test("rejects a missing isolation opt-in", () => {
  assert.throws(
    () => validatePostgresTestEnvironment({ ...valid, DS_TEST_POSTGRES_ISOLATED: undefined }),
    { message: "postgres_test_isolation_opt_in_required" },
  );
});

test("rejects a non-loopback database host", () => {
  assert.throws(
    () => validatePostgresTestEnvironment({
      ...valid,
      DS_TEST_DATABASE_URL: valid.DS_TEST_DATABASE_URL.replace("127.0.0.1", "db.internal"),
    }),
    { message: "postgres_test_database_url_host_invalid" },
  );
});

test("rejects a production-looking database name", () => {
  assert.throws(
    () => validatePostgresTestEnvironment({
      ...valid,
      DS_TEST_DATABASE_URL: valid.DS_TEST_DATABASE_URL.replace(
        "development_security_test_admin",
        "desarrollo_seguro",
      ),
    }),
    { message: "postgres_test_database_name_invalid" },
  );
});
