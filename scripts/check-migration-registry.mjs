import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const MIGRATIONS_DIRECTORY = join(
  ROOT,
  "apps/desarrollo-seguro/persistence/migrations",
);
const REGISTRY_PATH = join(
  ROOT,
  "apps/desarrollo-seguro/persistence/src/run-migrations.ts",
);

const registry = readFileSync(REGISTRY_PATH, "utf8");
const registeredMigrations = [
  ...registry.matchAll(
    /\{\s*version:\s*"([^"]+)"\s*,\s*file:\s*"([^"]+\.sql)"\s*,?\s*\}/g,
  ),
].map((match) => ({ version: match[1], file: match[2] }));
const registeredFiles = registeredMigrations.map(({ file }) => file);
const migrationFiles = readdirSync(MIGRATIONS_DIRECTORY)
  .filter((file) => file.endsWith(".sql"))
  .sort();
const registeredSet = new Set(registeredFiles);
const migrationSet = new Set(migrationFiles);
const missingFromRegistry = migrationFiles.filter(
  (file) => !registeredSet.has(file),
);
const missingFromDisk = registeredFiles.filter(
  (file) => !migrationSet.has(file),
);
const duplicateRegistrations = registeredFiles.filter(
  (file, index) => registeredFiles.indexOf(file) !== index,
);
const duplicateVersions = registeredMigrations
  .map(({ version }) => version)
  .filter((version, index, versions) => versions.indexOf(version) !== index);
const mismatchedVersions = registeredMigrations
  .filter(({ version, file }) => file !== `${version}.sql`)
  .map(({ version, file }) => `${version} -> ${file}`);

const failures = [];
if (missingFromRegistry.length > 0) {
  failures.push(
    `SQL migrations missing from the Desarrollo Seguro registry: ${missingFromRegistry.join(", ")}`,
  );
}
if (missingFromDisk.length > 0) {
  failures.push(
    `Registered migrations missing from apps/desarrollo-seguro/persistence/migrations: ${missingFromDisk.join(", ")}`,
  );
}
if (duplicateRegistrations.length > 0) {
  failures.push(
    `Migration files registered more than once: ${[...new Set(duplicateRegistrations)].join(", ")}`,
  );
}
if (duplicateVersions.length > 0) {
  failures.push(
    `Migration versions registered more than once: ${[...new Set(duplicateVersions)].join(", ")}`,
  );
}
if (mismatchedVersions.length > 0) {
  failures.push(
    `Migration version must match its SQL filename: ${mismatchedVersions.join(", ")}`,
  );
}

if (failures.length > 0) {
  console.error(
    `Migration registry check failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`,
  );
  process.exitCode = 1;
} else {
  console.log(
    `Migration registry check passed (${registeredFiles.length} migrations).`,
  );
}
