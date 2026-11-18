import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const script = await readFile("scripts/ci-verify.sh", "utf8");

assert.match(
  script,
  /pnpm audit --audit-level critical/u,
  "development dependency audits must block critical advisories",
);
assert.match(
  script,
  /pnpm audit --prod --audit-level high/u,
  "production dependency audits must block high advisories",
);
assert.doesNotMatch(
  script,
  /pnpm audit --audit-level moderate/u,
  "an unpatched development-only high advisory must not block the whole delivery",
);
assert.match(
  script,
  /Development-only high advisories[\s\S]*remain visible/u,
  "the non-blocking development audit policy must be explicit",
);
