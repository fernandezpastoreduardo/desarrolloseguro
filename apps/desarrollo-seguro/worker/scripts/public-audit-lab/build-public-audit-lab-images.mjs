#!/usr/bin/env node
import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { lstat, mkdtemp, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { X509Certificate } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

export const LAB_BROKER_IMAGE_REPOSITORY = "desarrolloseguro-public-audit-lab-broker";
export const LAB_PRIVACY_EGRESS_IMAGE_REPOSITORY = "desarrolloseguro-public-audit-lab-privacy-egress";
export const LAB_PRIVACY_BROWSER_IMAGE_REPOSITORY = "desarrolloseguro-public-audit-lab-privacy-browser";
export const LAB_CERTIFICATE_PATH = "/run/public-audit-lab/fixture.pem";
export const LAB_IMAGE_RUN_LABEL = "com.desarrolloseguro.public-audit-lab.run";
export const DEFAULT_BROKER_BASE_IMAGE = "desarrolloseguro-egress-broker:local";
export const DEFAULT_PRIVACY_EGRESS_BASE_IMAGE = "desarrolloseguro-privacy-egress:local";
export const DEFAULT_PRIVACY_BROWSER_BASE_IMAGE = "desarrolloseguro-privacy-browser:local";

/** Removes pnpm's script-argument separator while retaining direct node invocation. */
export function normalizeLabImageBuildArguments(args) {
  return Array.isArray(args) && args[0] === "--" ? args.slice(1) : args;
}

const RUN_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/u;
const IMAGE_PATTERN = /^desarrolloseguro-(?:egress-broker|privacy-egress|privacy-browser):[a-z0-9][a-z0-9._-]{0,127}$/u;
const MAX_CERTIFICATE_BYTES = 64 * 1024;
const REQUIRED_BUILD_FILES = [
  "lab-egress-broker.mjs",
  "lab-privacy-egress-entrypoint.mjs",
  "lab-privacy-browser-entrypoint.mjs",
  "egress-adapters.mjs",
];

/** Resolves and validates the exact per-run test image identities. */
export function resolveLabImageBuildConfiguration(args, environment = process.env) {
  if (!Array.isArray(args) || args.length < 2 || args.length > 5) {
    throw new Error("lab_image_build_arguments_invalid");
  }
  const [runId, certificatePath, brokerBaseImage = environment.DS_LAB_BROKER_BASE_IMAGE ?? DEFAULT_BROKER_BASE_IMAGE,
    privacyEgressBaseImage = environment.DS_LAB_PRIVACY_EGRESS_BASE_IMAGE ?? DEFAULT_PRIVACY_EGRESS_BASE_IMAGE,
    privacyBrowserBaseImage = environment.DS_LAB_PRIVACY_BROWSER_BASE_IMAGE ?? DEFAULT_PRIVACY_BROWSER_BASE_IMAGE] = args;
  if (typeof runId !== "string" || !RUN_ID_PATTERN.test(runId)) {
    throw new Error("lab_image_build_run_id_invalid");
  }
  if (typeof certificatePath !== "string" || certificatePath.length === 0 || certificatePath.includes("\0")) {
    throw new Error("lab_image_build_certificate_path_invalid");
  }
  if (typeof brokerBaseImage !== "string" || !IMAGE_PATTERN.test(brokerBaseImage) ||
      typeof privacyEgressBaseImage !== "string" || !IMAGE_PATTERN.test(privacyEgressBaseImage) ||
      typeof privacyBrowserBaseImage !== "string" || !IMAGE_PATTERN.test(privacyBrowserBaseImage)) {
    throw new Error("lab_image_build_base_image_invalid");
  }
  if (new Set([brokerBaseImage, privacyEgressBaseImage, privacyBrowserBaseImage]).size !== 3) {
    throw new Error("lab_image_build_base_image_invalid");
  }
  const dockerBinary = environment.DS_LAB_BUILD_DOCKER_BIN ?? "docker";
  if (typeof dockerBinary !== "string" || dockerBinary.length === 0 || dockerBinary.includes("\0")) {
    throw new Error("lab_image_build_docker_binary_invalid");
  }

  return Object.freeze({
    runId,
    certificatePath,
    brokerBaseImage,
    privacyEgressBaseImage,
    privacyBrowserBaseImage,
    brokerImage: `${LAB_BROKER_IMAGE_REPOSITORY}:${runId}`,
    privacyEgressImage: `${LAB_PRIVACY_EGRESS_IMAGE_REPOSITORY}:${runId}`,
    privacyBrowserImage: `${LAB_PRIVACY_BROWSER_IMAGE_REPOSITORY}:${runId}`,
    dockerBinary,
  });
}

/** Rejects symlinks, private-key PEMs, and certificates outside this run's SAN. */
export async function readPublicFixtureCertificate(certificatePath, runId) {
  let metadata;
  try {
    metadata = await lstat(certificatePath);
  } catch {
    throw new Error("lab_image_build_certificate_unreadable");
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 64 || metadata.size > MAX_CERTIFICATE_BYTES) {
    throw new Error("lab_image_build_certificate_invalid");
  }
  const certificatePem = await readFile(certificatePath, "utf8");
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u.test(certificatePem) ||
      !/^\s*-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----\s*$/u.test(certificatePem)) {
    throw new Error("lab_image_build_certificate_invalid");
  }
  if (Buffer.byteLength(certificatePem, "utf8") > MAX_CERTIFICATE_BYTES) {
    throw new Error("lab_image_build_certificate_invalid");
  }
  const hostname = `scan-${runId}.example.net`;
  try {
    const certificate = new X509Certificate(certificatePem);
    if (certificate.checkHost(hostname) !== hostname) {
      throw new Error("lab_image_build_certificate_hostname_mismatch");
    }
    if (certificate.ca) throw new Error("lab_image_build_certificate_invalid");
  } catch (error) {
    if (error instanceof Error && error.message === "lab_image_build_certificate_hostname_mismatch") throw error;
    if (error instanceof Error && error.message === "lab_image_build_certificate_invalid") throw error;
    throw new Error("lab_image_build_certificate_invalid", { cause: error });
  }
  return certificatePem;
}

export function createLabImageBuildArguments({
  dockerfile,
  contextDirectory,
  runId,
  target,
  image,
  brokerBaseImage,
  privacyEgressBaseImage,
  privacyBrowserBaseImage,
}) {
  const expectedTarget = target === "public-audit-lab-broker"
    ? `${LAB_BROKER_IMAGE_REPOSITORY}:${runId}`
    : target === "public-audit-lab-privacy-egress"
      ? `${LAB_PRIVACY_EGRESS_IMAGE_REPOSITORY}:${runId}`
      : `${LAB_PRIVACY_BROWSER_IMAGE_REPOSITORY}:${runId}`;
  if (!RUN_ID_PATTERN.test(runId) || !new Set([
    "public-audit-lab-broker", "public-audit-lab-privacy-egress", "public-audit-lab-privacy-browser",
  ]).has(target) ||
      image !== expectedTarget || typeof brokerBaseImage !== "string" || !IMAGE_PATTERN.test(brokerBaseImage) ||
      typeof privacyEgressBaseImage !== "string" || !IMAGE_PATTERN.test(privacyEgressBaseImage) ||
      typeof privacyBrowserBaseImage !== "string" || !IMAGE_PATTERN.test(privacyBrowserBaseImage) ||
      !dockerfile || !contextDirectory) {
    throw new Error("lab_image_build_arguments_invalid");
  }
  return [
    "build",
    "--file", dockerfile,
    "--target", target,
    "--build-arg", `DS_LAB_RUN_ID=${runId}`,
    "--build-arg", `DS_LAB_BROKER_BASE_IMAGE=${brokerBaseImage}`,
    "--build-arg", `DS_LAB_PRIVACY_EGRESS_BASE_IMAGE=${privacyEgressBaseImage}`,
    "--build-arg", `DS_LAB_PRIVACY_BROWSER_BASE_IMAGE=${privacyBrowserBaseImage}`,
    "--tag", image,
    contextDirectory,
  ];
}

export function createLabImageSmokeArguments({ image, runId, kind }) {
  const imageRepository = kind === "broker"
    ? LAB_BROKER_IMAGE_REPOSITORY
    : kind === "privacy-egress"
      ? LAB_PRIVACY_EGRESS_IMAGE_REPOSITORY
      : LAB_PRIVACY_BROWSER_IMAGE_REPOSITORY;
  if (!RUN_ID_PATTERN.test(runId) ||
      !new Set(["broker", "privacy-egress", "privacy-browser"]).has(kind) ||
      image !== `${imageRepository}:${runId}`) {
    throw new Error("lab_image_smoke_arguments_invalid");
  }
  const hostname = `scan-${runId}.example.net`;
  const fixtureAlias = `public-audit-fixture-${runId}`;
  const modulePath = "/workspace/apps/desarrollo-seguro/worker/scripts/public-audit-lab";
  const configSmoke = kind === "broker"
    ? `const {parseLabEgressConfiguration,readMountedLabCertificate}=await import("${modulePath}/lab-egress-broker.mjs");
      const config=parseLabEgressConfiguration(process.env,{hostname:${JSON.stringify(hostname)},profileVersion:"domain-v5",targetPath:"/careers?source=smoke"});
      const pem=await readMountedLabCertificate(config);
      if(new X509Certificate(pem).checkHost(config.hostname)!==config.hostname||pem.includes("PRIVATE KEY"))process.exit(1);`
    : kind === "privacy-egress"
      ? `const {resolveLabPrivacyEgressConfiguration}=await import("${modulePath}/lab-privacy-egress-entrypoint.mjs");
      const config=await resolveLabPrivacyEgressConfiguration(process.env);
      if(config.runId!==${JSON.stringify(runId)}||config.hostname!==${JSON.stringify(hostname)}||config.fixtureAlias!==${JSON.stringify(fixtureAlias)}||new X509Certificate(config.certificatePem).checkHost(config.hostname)!==config.hostname||config.certificatePem.includes("PRIVATE KEY"))process.exit(1);`
      : `const {createLabBrowserLaunchers,parseLabPrivacyBrowserInput}=await import("${modulePath}/lab-privacy-browser-entrypoint.mjs");
      const configuredRunId=process.env.DS_LAB_RUN_ID;
      const configuredHostname="scan-"+configuredRunId+".example.net";
      const input=parseLabPrivacyBrowserInput({protocolVersion:1,requestId:"00000000-0000-4000-8000-000000000001",hostname:configuredHostname,targetUrl:"https://"+configuredHostname+"/?lab="+configuredRunId});
      const options={args:["--disable-background-networking"]};
      let launchOptions;const launch=async(value)=>{launchOptions=value;return {};};
      const launchers=createLabBrowserLaunchers({playwright:{launch},puppeteerCore:{launch}});
      await launchers.launchPlaywright(options);
      const cert=await import("node:fs/promises").then(({readFile})=>readFile("${LAB_CERTIFICATE_PATH}","utf8"));
      if(configuredRunId!==${JSON.stringify(runId)}||input.hostname!==${JSON.stringify(hostname)}||!launchOptions.args.includes("--ignore-certificate-errors")||new X509Certificate(cert).checkHost(input.hostname)!==input.hostname||cert.includes("PRIVATE KEY"))process.exit(1);`;
  const smokeSource = `import {X509Certificate} from "node:crypto";${configSmoke}\nconsole.log("lab_image_config_certificate_smoke_passed");`;
  const environment = kind === "broker"
    ? [
      `DS_LAB_RUN_ID=${runId}`,
      `DS_LAB_HOSTNAME=${hostname}`,
      `DS_LAB_FIXTURE_ALIAS=${fixtureAlias}`,
      `DS_LAB_FIXTURE_HOST=${fixtureAlias}`,
      `DS_LAB_CA_FILE=${LAB_CERTIFICATE_PATH}`,
      "DS_LAB_HTTPS_PORT=8443",
      "DS_LAB_HTTP_PORT=8080",
    ]
    : kind === "privacy-egress"
      ? [
      `DS_LAB_RUN_ID=${runId}`,
      `DS_LAB_HOSTNAME=${hostname}`,
      `DS_LAB_FIXTURE_ALIAS=${fixtureAlias}`,
      `DS_LAB_FIXTURE_CA_FILE=${LAB_CERTIFICATE_PATH}`,
      "DS_LAB_PRIVACY_PROXY_PORT=3128",
      "DS_LAB_FIXTURE_HTTPS_PORT=8443",
      "DS_LAB_FIXTURE_HTTP_PORT=8080",
      ]
      : [`DS_LAB_RUN_ID=${runId}`];
  const resourceLimits = kind === "privacy-browser"
    ? ["--memory", "512m", "--cpus", "0.5", "--shm-size", "128m"]
    : ["--memory", "128m", "--cpus", "0.25"];
  const userArguments = kind === "privacy-browser" ? [] : ["--user", "1000:1000"];
  const temporaryDirectory = kind === "privacy-browser"
    ? "/tmp:rw,noexec,nosuid,size=64m,uid=1001,gid=1001"
    : "/tmp:rw,noexec,nosuid,size=16m,uid=1000,gid=1000";
  return [
    "run", "--rm", "--network", "none", "--read-only", ...userArguments,
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "64",
    ...resourceLimits, "--tmpfs", temporaryDirectory,
    ...environment.flatMap((value) => ["--env", value]),
    "--entrypoint", "node", image, "--input-type=module", "-e", smokeSource,
  ];
}

async function buildAndSmoke(configuration) {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const dockerfile = join(scriptDirectory, "images", "Dockerfile");
  const certificatePem = await readPublicFixtureCertificate(configuration.certificatePath, configuration.runId);
  const contextDirectory = await mkdtemp(join(tmpdir(), `ds-public-audit-lab-${configuration.runId}-`));
  try {
    await writeFile(join(contextDirectory, "fixture.pem"), certificatePem, { mode: 0o444, flag: "wx" });
    for (const fileName of REQUIRED_BUILD_FILES) {
      await copyBuildFile(join(scriptDirectory, fileName), join(contextDirectory, fileName));
    }
    await chmod(contextDirectory, 0o700);
    const dockerArgs = [
      ["image", "inspect", "--format", "{{.Id}}", configuration.brokerBaseImage],
      ["image", "inspect", "--format", "{{.Id}}", configuration.privacyEgressBaseImage],
      ["image", "inspect", "--format", "{{.Id}}", configuration.privacyBrowserBaseImage],
      createLabImageBuildArguments({
        dockerfile,
        contextDirectory,
        runId: configuration.runId,
        target: "public-audit-lab-broker",
        image: configuration.brokerImage,
        brokerBaseImage: configuration.brokerBaseImage,
        privacyEgressBaseImage: configuration.privacyEgressBaseImage,
        privacyBrowserBaseImage: configuration.privacyBrowserBaseImage,
      }),
      createLabImageBuildArguments({
        dockerfile,
        contextDirectory,
        runId: configuration.runId,
        target: "public-audit-lab-privacy-egress",
        image: configuration.privacyEgressImage,
        brokerBaseImage: configuration.brokerBaseImage,
        privacyEgressBaseImage: configuration.privacyEgressBaseImage,
        privacyBrowserBaseImage: configuration.privacyBrowserBaseImage,
      }),
      createLabImageBuildArguments({
        dockerfile,
        contextDirectory,
        runId: configuration.runId,
        target: "public-audit-lab-privacy-browser",
        image: configuration.privacyBrowserImage,
        brokerBaseImage: configuration.brokerBaseImage,
        privacyEgressBaseImage: configuration.privacyEgressBaseImage,
        privacyBrowserBaseImage: configuration.privacyBrowserBaseImage,
      }),
    ];
    for (const args of dockerArgs) await runDocker(configuration.dockerBinary, args);
    await assertImageRunLabel(configuration.dockerBinary, configuration.brokerImage, configuration.runId);
    await assertImageRunLabel(configuration.dockerBinary, configuration.privacyEgressImage, configuration.runId);
    await assertImageRunLabel(configuration.dockerBinary, configuration.privacyBrowserImage, configuration.runId);
    await runDocker(configuration.dockerBinary, createLabImageSmokeArguments({
      image: configuration.brokerImage,
      runId: configuration.runId,
      kind: "broker",
    }));
    await runDocker(configuration.dockerBinary, createLabImageSmokeArguments({
      image: configuration.privacyEgressImage,
      runId: configuration.runId,
      kind: "privacy-egress",
    }));
    await runDocker(configuration.dockerBinary, createLabImageSmokeArguments({
      image: configuration.privacyBrowserImage,
      runId: configuration.runId,
      kind: "privacy-browser",
    }));
    process.stdout.write("Public audit lab test images built and configuration/certificate smoke passed.\n");
  } finally {
    await rm(contextDirectory, { recursive: true, force: true });
  }
}

async function copyBuildFile(sourcePath, destinationPath) {
  const metadata = await lstat(sourcePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("lab_image_build_source_invalid");
  const contents = await readFile(sourcePath);
  await writeFile(destinationPath, contents, { mode: 0o444, flag: "wx" });
}

function assertImageRunLabel(dockerBinary, image, runId) {
  return runDocker(dockerBinary, [
    "image", "inspect", "--format", `{{index .Config.Labels "${LAB_IMAGE_RUN_LABEL}"}}`, image,
  ], true).then((label) => {
    if (label.trim() !== runId) throw new Error("lab_image_build_run_label_mismatch");
  });
}

function runDocker(dockerBinary, args, captureStdout = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(dockerBinary, args, {
      stdio: captureStdout ? ["ignore", "pipe", "inherit"] : "inherit",
    });
    let stdout = "";
    if (captureStdout) child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > 8 * 1024) child.kill("SIGTERM");
    });
    child.once("error", () => reject(new Error("lab_image_build_docker_command_failed")));
    child.once("exit", (code) => {
      if (code !== 0) reject(new Error("lab_image_build_docker_command_failed"));
      else resolve(stdout);
    });
  });
}

async function main() {
  const configuration = resolveLabImageBuildConfiguration(normalizeLabImageBuildArguments(process.argv.slice(2)));
  await buildAndSmoke(configuration);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const code = error instanceof Error && /^lab_image_build_[a-z_]+$/u.test(error.message)
      ? error.message
      : "lab_image_build_failed";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  });
}
