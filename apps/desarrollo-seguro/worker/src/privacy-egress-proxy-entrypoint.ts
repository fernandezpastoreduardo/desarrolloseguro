import { createPrivacyEgressProxy } from "./privacy-egress-proxy.js";

const DEFAULT_RECEIVED_BYTE_LIMIT = 20 * 1024 * 1024;
const PORT = 3_128;

async function main(): Promise<void> {
  const maxReceivedBytes = readPositiveInteger(process.env.DS_PRIVACY_MAX_RECEIVED_BYTES, DEFAULT_RECEIVED_BYTE_LIMIT);
  const proxy = createPrivacyEgressProxy({ host: "0.0.0.0", port: PORT, maxReceivedBytes });
  await proxy.listen();
  process.stdout.write(`${JSON.stringify({ event: "privacy_proxy_ready", port: PORT })}\n`);

  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    try {
      await proxy.close();
      process.stdout.write(`${JSON.stringify({ event: "privacy_proxy_stats", ...proxy.stats() })}\n`);
      process.exitCode = 0;
    } catch {
      process.stderr.write("privacy_proxy_close_failed\n");
      process.exitCode = 1;
    }
  };
  process.once("SIGTERM", () => { void close(); });
  process.once("SIGINT", () => { void close(); });
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 20 * 1024 * 1024) throw new Error("privacy_proxy_limit_invalid");
  return parsed;
}

void main().catch(() => {
  process.stderr.write("privacy_proxy_start_failed\n");
  process.exitCode = 1;
});
