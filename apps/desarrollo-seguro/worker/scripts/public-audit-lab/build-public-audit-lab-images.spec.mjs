import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_BROKER_BASE_IMAGE,
  DEFAULT_PRIVACY_BROWSER_BASE_IMAGE,
  DEFAULT_PRIVACY_EGRESS_BASE_IMAGE,
  LAB_BROKER_IMAGE_REPOSITORY,
  LAB_CERTIFICATE_PATH,
  LAB_IMAGE_RUN_LABEL,
  LAB_PRIVACY_BROWSER_IMAGE_REPOSITORY,
  LAB_PRIVACY_EGRESS_IMAGE_REPOSITORY,
  createLabImageBuildArguments,
  createLabImageSmokeArguments,
  normalizeLabImageBuildArguments,
  readPublicFixtureCertificate,
  resolveLabImageBuildConfiguration,
} from "./build-public-audit-lab-images.mjs";

const { createEphemeralHttpsFixture } = createRequire(import.meta.url)("../../test/fixtures/https-fixture.cjs");
const RUN_ID = "fixture";
let temporaryDirectory;
let certificatePem;
let certificatePath;

beforeAll(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "ds-lab-image-builder-test-"));
  certificatePem = createEphemeralHttpsFixture().certificate;
  certificatePath = join(temporaryDirectory, "fixture.pem");
  await writeFile(certificatePath, certificatePem, { mode: 0o600 });
});

afterAll(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
});

describe("public audit lab test image builder", () => {
  it("normalizes pnpm's argument separator while keeping direct Node arguments", () => {
    const argumentsList = [RUN_ID, "/tmp/fixture.pem"];
    expect(normalizeLabImageBuildArguments(argumentsList)).toEqual(argumentsList);
    expect(normalizeLabImageBuildArguments(["--", ...argumentsList])).toEqual(argumentsList);
  });

  it("resolves exact per-run image refs and prebuilt production base refs", () => {
    expect(resolveLabImageBuildConfiguration([RUN_ID, certificatePath])).toMatchObject({
      runId: RUN_ID,
      brokerImage: `${LAB_BROKER_IMAGE_REPOSITORY}:${RUN_ID}`,
      privacyEgressImage: `${LAB_PRIVACY_EGRESS_IMAGE_REPOSITORY}:${RUN_ID}`,
      privacyBrowserImage: `${LAB_PRIVACY_BROWSER_IMAGE_REPOSITORY}:${RUN_ID}`,
      brokerBaseImage: DEFAULT_BROKER_BASE_IMAGE,
      privacyEgressBaseImage: DEFAULT_PRIVACY_EGRESS_BASE_IMAGE,
      privacyBrowserBaseImage: DEFAULT_PRIVACY_BROWSER_BASE_IMAGE,
      certificatePath,
    });
    expect(() => resolveLabImageBuildConfiguration(["../other", certificatePath]))
      .toThrow("lab_image_build_run_id_invalid");
    expect(() => resolveLabImageBuildConfiguration([RUN_ID, certificatePath, "unrelated:local"]))
      .toThrow("lab_image_build_base_image_invalid");
    expect(() => resolveLabImageBuildConfiguration([RUN_ID, certificatePath,
      DEFAULT_BROKER_BASE_IMAGE, DEFAULT_BROKER_BASE_IMAGE]))
      .toThrow("lab_image_build_base_image_invalid");
  });

  it("accepts only a public certificate whose SAN matches the run hostname", async () => {
    expect(await readPublicFixtureCertificate(certificatePath, RUN_ID)).toBe(certificatePem);
    await expect(readPublicFixtureCertificate(certificatePath, "another-run"))
      .rejects.toThrow("lab_image_build_certificate_hostname_mismatch");
    const keyPath = join(temporaryDirectory, "private-key.pem");
    await writeFile(keyPath, `${certificatePem}\n-----BEGIN PRIVATE KEY-----\nnot-a-key\n-----END PRIVATE KEY-----\n`);
    await expect(readPublicFixtureCertificate(keyPath, RUN_ID))
      .rejects.toThrow("lab_image_build_certificate_invalid");
    const linkPath = join(temporaryDirectory, "certificate-link.pem");
    await symlink(certificatePath, linkPath);
    await expect(readPublicFixtureCertificate(linkPath, RUN_ID))
      .rejects.toThrow("lab_image_build_certificate_invalid");
  });

  it("builds only the named test target from the pinned production image refs", () => {
    const values = {
      dockerfile: "/repo/apps/desarrollo-seguro/worker/scripts/public-audit-lab/images/Dockerfile",
      contextDirectory: "/tmp/ds-lab-run",
      runId: RUN_ID,
      target: "public-audit-lab-broker",
      image: `${LAB_BROKER_IMAGE_REPOSITORY}:${RUN_ID}`,
      brokerBaseImage: "desarrolloseguro-egress-broker:0123456789abcdef",
      privacyEgressBaseImage: "desarrolloseguro-privacy-egress:0123456789abcdef",
      privacyBrowserBaseImage: "desarrolloseguro-privacy-browser:0123456789abcdef",
    };
    expect(createLabImageBuildArguments(values)).toEqual([
      "build", "--file", values.dockerfile,
      "--target", "public-audit-lab-broker",
      "--build-arg", `DS_LAB_RUN_ID=${RUN_ID}`,
      "--build-arg", `DS_LAB_BROKER_BASE_IMAGE=${values.brokerBaseImage}`,
      "--build-arg", `DS_LAB_PRIVACY_EGRESS_BASE_IMAGE=${values.privacyEgressBaseImage}`,
      "--build-arg", `DS_LAB_PRIVACY_BROWSER_BASE_IMAGE=${values.privacyBrowserBaseImage}`,
      "--tag", values.image, values.contextDirectory,
    ]);
    expect(() => createLabImageBuildArguments({ ...values, image: values.brokerBaseImage }))
      .toThrow("lab_image_build_arguments_invalid");
  });

  it("runs broker and proxy configuration/certificate smoke with no network or certificate mount", () => {
    const brokerImage = `${LAB_BROKER_IMAGE_REPOSITORY}:${RUN_ID}`;
    const proxyImage = `${LAB_PRIVACY_EGRESS_IMAGE_REPOSITORY}:${RUN_ID}`;
    const browserImage = `${LAB_PRIVACY_BROWSER_IMAGE_REPOSITORY}:${RUN_ID}`;
    const brokerArgs = createLabImageSmokeArguments({ image: brokerImage, runId: RUN_ID, kind: "broker" });
    const proxyArgs = createLabImageSmokeArguments({ image: proxyImage, runId: RUN_ID, kind: "privacy-egress" });
    const browserArgs = createLabImageSmokeArguments({ image: browserImage, runId: RUN_ID, kind: "privacy-browser" });
    for (const args of [brokerArgs, proxyArgs, browserArgs]) {
      expect(args).toContain("--network");
      expect(args).toContain("none");
      expect(args).toContain("--entrypoint");
      expect(args).not.toContain("--mount");
      expect(args.at(-1)).toContain("new X509Certificate");
    }
    expect(brokerArgs).toContain(`DS_LAB_CA_FILE=${LAB_CERTIFICATE_PATH}`);
    expect(brokerArgs).toContain(`DS_LAB_FIXTURE_HOST=public-audit-fixture-${RUN_ID}`);
    expect(proxyArgs).toContain(`DS_LAB_FIXTURE_CA_FILE=${LAB_CERTIFICATE_PATH}`);
    expect(proxyArgs).toContain(`DS_LAB_FIXTURE_ALIAS=public-audit-fixture-${RUN_ID}`);
    expect(browserArgs).toContain(`DS_LAB_RUN_ID=${RUN_ID}`);
    expect(browserArgs).not.toContain("--user");
    expect(browserArgs).toContain("/tmp:rw,noexec,nosuid,size=64m,uid=1001,gid=1001");
    expect(browserArgs.at(-1)).toContain("--ignore-certificate-errors");
    expect(browserArgs.at(-1)).toContain("new X509Certificate(cert)");
    expect(() => createLabImageSmokeArguments({ image: "desarrolloseguro-egress-broker:local", runId: RUN_ID, kind: "broker" }))
      .toThrow("lab_image_smoke_arguments_invalid");
    expect(LAB_IMAGE_RUN_LABEL).toBe("com.desarrolloseguro.public-audit-lab.run");
  });
});
