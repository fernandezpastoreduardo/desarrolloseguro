import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [compose, projectProperties] = await Promise.all([
  readFile("compose.sonarqube.local.yaml", "utf8"),
  readFile("sonar-project.properties", "utf8"),
]);
const packageManifest = JSON.parse(await readFile("package.json", "utf8"));
const scanRunner = await readFile("scripts/run-sonarqube-local.mjs", "utf8");
const databaseService = compose.match(
  /^  development-security-sonar-database:\n([\s\S]*?)(?=^  development-security-sonarqube:)/mu,
);

assert.ok(databaseService, "Local SonarQube database service must exist");
assert.match(compose, /image:\s*sonarqube:26\.10\.0\.133078-community/u);
assert.match(compose, /SONAR_TELEMETRY_ENABLE:\s*"false"/u);
assert.match(compose, /127\.0\.0\.1:9000:9000/u);
assert.match(compose, /internal:\s*true/u);
assert.match(compose, /com\.docker\.network\.bridge\.enable_ip_masquerade:\s*"false"/u);
assert.match(compose, /com\.docker\.network\.bridge\.host_binding_ipv4:\s*"127\.0\.0\.1"/u);
assert.doesNotMatch(databaseService[1], /^\s+ports:/mu);
assert.doesNotMatch(compose, /SONAR_TOKEN|sonar\.token/iu);
assert.match(projectProperties, /^sonar\.host\.url=http:\/\/127\.0\.0\.1:9000$/mu);
assert.match(projectProperties, /^sonar\.qualitygate\.wait=true$/mu);
assert.match(projectProperties, /^sonar\.javascript\.lcov\.reportPaths=/mu);
assert.doesNotMatch(projectProperties, /SONAR_TOKEN|sonar\.token/iu);
assert.match(packageManifest.scripts["quality:sonar"], /run-sonarqube-local\.mjs/u);
assert.match(scanRunner, /readFileSync\(environmentFile, "utf8"\)/u);
assert.match(scanRunner, /SONAR_TOKEN: token/u);
assert.match(scanRunner, /sonar-scanner-npm/u);
assert.doesNotMatch(scanRunner, /console\.(?:log|info|debug)\(.*token/isu);

process.stdout.write("Local SonarQube privacy policy passed.\n");
