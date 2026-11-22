import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startProcessorAuditor } from "./processor-auditor-server.js";

function readInteger(environment: NodeJS.ProcessEnv, key: string): number {
  const value = environment[key];
  if (!value || !/^\d+$/u.test(value)) throw new Error("processor_auditor_configuration_invalid");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error("processor_auditor_configuration_invalid");
  return parsed;
}

export async function startProcessorAuditorFromEnvironment(environment: NodeJS.ProcessEnv) {
  const socketPath = environment.DS_PROCESSOR_AUDITOR_SOCKET;
  if (!socketPath || !socketPath.startsWith("/")) throw new Error("processor_auditor_configuration_invalid");
  return startProcessorAuditor(environment, {
    socketPath,
    socketUid: readInteger(environment, "DS_PROCESSOR_AUDITOR_UID"),
    socketGid: readInteger(environment, "DS_PROCESSOR_AUDITOR_GID"),
  });
}

async function main(): Promise<void> {
  try {
    const server = await startProcessorAuditorFromEnvironment(process.env);
    let closing = false;
    const close = () => {
      if (closing) return;
      closing = true;
      void server.close().then(
        () => { process.exitCode = 0; },
        () => { process.stderr.write("processor_auditor_shutdown_failed\n"); process.exitCode = 1; },
      );
    };
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
    await new Promise<void>((resolveWait) => process.once("beforeExit", resolveWait));
  } catch {
    process.stderr.write("processor_auditor_startup_failed\n");
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
