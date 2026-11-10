import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const environmentFile = ".env.sonar.local";

function readLocalToken() {
  let contents;

  try {
    contents = readFileSync(environmentFile, "utf8");
  } catch {
    process.stderr.write(
      `Missing ${environmentFile}; copy .env.sonar.local.example and configure the local SonarQube secrets.\n`,
    );
    process.exit(2);
  }

  const tokenLine = contents
    .split(/\r?\n/u)
    .find((line) => line.startsWith("SONAR_TOKEN="));
  const token = tokenLine?.slice("SONAR_TOKEN=".length).trim();

  if (!token) {
    process.stderr.write(
      `SONAR_TOKEN is missing from ${environmentFile}; create a project analysis token in local SonarQube.\n`,
    );
    process.exit(2);
  }

  return token;
}

const token = readLocalToken();
const result = spawnSync("pnpm", ["exec", "sonar-scanner-npm"], {
  env: { ...process.env, SONAR_TOKEN: token },
  stdio: "inherit",
});

if (result.error) {
  process.stderr.write("Could not start the local SonarQube scanner.\n");
  process.exit(2);
}

process.exit(result.status ?? 1);
