import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:net";

export const REQUIRED_CATEGORIES = [
  "performance",
  "accessibility",
  "best-practices",
];
export const INFORMATIONAL_CATEGORIES = ["seo"];
export const MINIMUM_SCORE = 96;

export function lighthouseChromeFlags({ ci = process.env.CI === "true", platform = process.platform } = {}) {
  const flags = ["--headless", "--disable-extensions"];
  if (ci && platform === "linux") flags.push("--no-sandbox", "--disable-dev-shm-usage");
  return flags.join(" ");
}

export function inspectLighthouseReport(report, expectedOrigin, minimumScore = MINIMUM_SCORE) {
  const categories = {};
  const failures = [];
  for (const categoryId of REQUIRED_CATEGORIES) {
    const score = report.categories?.[categoryId]?.score;
    if (typeof score !== "number" || !Number.isFinite(score)) {
      failures.push(`${categoryId}: missing score`);
      continue;
    }
    const percentage = Math.round(score * 100);
    categories[categoryId] = percentage;
    if (percentage < minimumScore) failures.push(`${categoryId}: ${percentage} < ${minimumScore}`);
  }
  for (const categoryId of INFORMATIONAL_CATEGORIES) {
    const score = report.categories?.[categoryId]?.score;
    categories[categoryId] = typeof score === "number" && Number.isFinite(score)
      ? Math.round(score * 100)
      : null;
  }

  const requests = report.audits?.["network-requests"]?.details?.items;
  if (!Array.isArray(requests)) {
    failures.push("privacy: network request evidence is missing");
  } else {
    for (const request of requests) {
      if (typeof request.url !== "string") continue;
      let requestUrl;
      try {
        requestUrl = new URL(request.url);
      } catch {
        failures.push("privacy: malformed request URL in Lighthouse report");
        continue;
      }
      if (requestUrl.protocol !== "data:" && requestUrl.origin !== expectedOrigin) {
        failures.push(`privacy: external request to ${requestUrl.origin}`);
      }
    }
  }
  return { categories, failures };
}

async function findAvailablePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("lighthouse_port_unavailable");
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return address.port;
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], ...options });
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) resolveRun();
      else reject(new Error(`lighthouse_process_failed:${code ?? signal}:${stderr.slice(-2000)}`));
    });
  });
}

async function waitForServer(url, child, getStderr) {
  if (child.pid === undefined) {
    await new Promise((resolveSpawn, rejectSpawn) => {
      child.once("spawn", resolveSpawn);
      child.once("error", rejectSpawn);
    });
  }
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null && child.exitCode !== undefined) {
      throw new Error(`lighthouse_preview_exited_early:${getStderr()}`);
    }
    if (child.signalCode !== null && child.signalCode !== undefined) {
      throw new Error(`lighthouse_preview_signaled_early:${child.signalCode}:${getStderr()}`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 150));
    }
  }
  throw new Error("lighthouse_preview_timeout");
}

async function runLighthouse({ url, outputPath, preset, chromePath, cwd }) {
  const args = [
    "exec", "lighthouse", url,
    "--output=json",
    `--output-path=${outputPath}`,
    "--quiet",
    "--no-enable-error-reporting",
    "--only-categories=performance,accessibility,best-practices,seo",
    `--chrome-flags=${lighthouseChromeFlags()}`,
  ];
  if (preset) args.push(`--preset=${preset}`);
  await run("pnpm", args, {
    cwd,
    env: { ...process.env, CHROME_PATH: chromePath },
  });
  return JSON.parse(await readFile(outputPath, "utf8"));
}

export async function runLighthouseLab({ cwd = process.cwd() } = {}) {
  const webDirectory = join(cwd, "apps/desarrollo-seguro/web");
  const previewPort = await findAvailablePort();
  const baseUrl = `http://127.0.0.1:${previewPort}/app/`;
  const artifactDirectory = await mkdtemp(join(tmpdir(), "desarrollo-seguro-lighthouse-"));
  let preview;

  try {
    await run("pnpm", ["--filter", "@desarrolloseguro/web", "build"], { cwd });
    preview = spawn(process.execPath, [
      join(webDirectory, "node_modules/vite/bin/vite.js"),
      "preview", "--host", "127.0.0.1", "--port", String(previewPort), "--strictPort",
    ], { cwd: webDirectory, stdio: ["ignore", "pipe", "pipe"] });
    let previewStderr = "";
    preview.stdout?.resume();
    preview.stderr?.on("data", (chunk) => {
      previewStderr = `${previewStderr}${chunk}`.slice(-2_000);
    });
    await waitForServer(baseUrl, preview, () => previewStderr);
    const requireFromWeb = createRequire(join(webDirectory, "package.json"));
    const chromePath = process.env.CHROME_PATH || requireFromWeb("@playwright/test").chromium.executablePath();
    const reports = [
      { label: "mobile", preset: undefined },
      { label: "desktop", preset: "desktop" },
    ];
    let failed = false;
    for (const reportSpec of reports) {
      const path = join(artifactDirectory, `${reportSpec.label}.json`);
      const report = await runLighthouse({
        url: baseUrl,
        outputPath: path,
        preset: reportSpec.preset,
        chromePath,
        cwd,
      });
      const result = inspectLighthouseReport(report, new URL(baseUrl).origin);
      process.stdout.write(`Lighthouse ${reportSpec.label}: ${JSON.stringify(result.categories)}\n`);
      for (const failure of result.failures) process.stderr.write(`Lighthouse ${reportSpec.label} failed: ${failure}\n`);
      if (result.failures.length > 0) failed = true;
    }
    if (failed) process.exitCode = 1;
  } finally {
    if (preview) {
      preview.kill("SIGTERM");
      await new Promise((resolveExit) => {
        if (preview.exitCode !== null) return resolveExit();
        const timeout = setTimeout(() => { preview.kill("SIGKILL"); resolveExit(); }, 3_000);
        preview.once("exit", () => { clearTimeout(timeout); resolveExit(); });
      });
    }
    await rm(artifactDirectory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runLighthouseLab();
}
