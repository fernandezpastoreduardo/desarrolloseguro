import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROUTES = [
  ["infrastructure_snapshot", "/audit/infrastructure"],
  ["deployment_attestation", "/audit/deployment"],
  ["dependency_inventory", "/audit/dependencies"],
  ["synthetic_browser_flow", "/audit/auth"],
  ["performance_observation", "/audit/quality"],
  ["privacy_observation", "/audit/privacy"],
  ["ai_observation", "/audit/ai"],
];

const routeSources = [
  "scripts/check-internal-audit-resources.mjs",
  "apps/desarrollo-seguro/core/src/internal-audit-access.ts",
  "apps/desarrollo-seguro/worker/src/internal-audit-runtime.ts",
].map(readSource);
const runnerSource = readSource("apps/desarrollo-seguro/core/src/internal-audit-runner.ts");

for (const [resource, path] of ROUTES) {
  const routePattern = new RegExp(`${escapeRegExp(resource)}[\\s\\S]{0,180}${escapeRegExp(path)}`, "u");
  for (const source of routeSources) {
    assert.match(source, routePattern, `missing route mapping ${resource} -> ${path}`);
  }
  assert.match(runnerSource, new RegExp(`"${escapeRegExp(resource)}"`, "u"), `runner missing resource ${resource}`);
}

process.stdout.write(`Internal audit route policy passed (${ROUTES.length} routes).\n`);

function readSource(relativePath) {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\[\]\\]/gu, "\\$&");
}
