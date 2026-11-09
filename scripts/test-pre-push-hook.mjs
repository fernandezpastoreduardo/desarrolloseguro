import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const HOOK_PATH = resolve(".husky/pre-push");
const TEMP_DIRECTORY = await mkdtemp(join(tmpdir(), "desarrollo-seguro-pre-push-"));
const BIN_DIRECTORY = join(TEMP_DIRECTORY, "bin");
const COMMAND_LOG_PATH = join(TEMP_DIRECTORY, "commands.log");
const FAKE_PNPM_PATH = join(BIN_DIRECTORY, "pnpm");

await mkdir(BIN_DIRECTORY);
await writeFile(
  FAKE_PNPM_PATH,
  [
    "#!/usr/bin/env sh",
    'printf "%s\\n" "$*" >> "$PRE_PUSH_COMMAND_LOG"',
    '',
    "",
  ].join("\n"),
  { mode: 0o755 },
);

async function runHook(pushRefs, { failE2e = false } = {}) {
  await rm(COMMAND_LOG_PATH, { force: true });
  const result = spawnSync("sh", [HOOK_PATH], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${BIN_DIRECTORY}${delimiter}${process.env.PATH ?? ""}`,
      PRE_PUSH_COMMAND_LOG: COMMAND_LOG_PATH,
      FAIL_E2E: String(failE2e),
    },
    input: pushRefs,
  });
  const commands = await readFile(COMMAND_LOG_PATH, "utf8").then((contents) =>
    contents.trim().split("\n").filter(Boolean),
  );
  return { ...result, commands };
}

try {
  const featurePush = await runHook(
    "refs/heads/feature/example 1111111111111111111111111111111111111111 refs/heads/feature/example 0000000000000000000000000000000000000000\n",
  );
  assert.equal(featurePush.status, 0);
  assert.deepEqual(featurePush.commands, ["migrations:check"]);

  const mainPush = await runHook(
    "refs/heads/feature/example 1111111111111111111111111111111111111111 refs/heads/main 0000000000000000000000000000000000000000\n",
  );
  assert.equal(mainPush.status, 0);
  assert.deepEqual(mainPush.commands, ["migrations:check"]);

  const mainDeletion = await runHook(
    "(delete) 0000000000000000000000000000000000000000 refs/heads/main 1111111111111111111111111111111111111111\n",
  );
  assert.equal(mainDeletion.status, 0);
  assert.deepEqual(mainDeletion.commands, ["migrations:check"]);

  console.log("pre-push hook policy checks passed");
} finally {
  await rm(TEMP_DIRECTORY, { recursive: true, force: true });
}
