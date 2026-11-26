import { type PrivacyBrowserInput } from "./privacy-browser-observer.js";
import { observePrivacyAndPerformance } from "./privacy-browser-observation.js";
import { parseScanTargetUrl } from "@desarrolloseguro/core";
import { PRIVACY_BROWSER_MAX_RESPONSE_BYTES } from "./privacy-browser-contract.js";

const MAX_INPUT_BYTES = 4 * 1024;
// This URL is reachable only on the per-job internal Docker network; CONNECT payloads remain end-to-end TLS.
const PROXY_URL = process.env.DS_PRIVACY_PROXY_URL ?? "http://privacy-egress:3128"; // NOSONAR

async function main(): Promise<void> {
  let input: PrivacyBrowserInput;
  try {
    input = parseInput(await readInput());
  } catch {
    process.stdout.write(`${JSON.stringify({ protocolVersion: 1, status: "unknown", code: "privacy_browser_request_invalid" })}\n`);
    process.exitCode = 0;
    return;
  }

  const result = await observePrivacyAndPerformance(input, {
    proxyUrl: PROXY_URL,
    onProgress: (progressEvent) => process.stdout.write(`${JSON.stringify({ protocolVersion: 1, requestId: input.requestId, progressEvent })}\n`),
  });
  const serialized = `${JSON.stringify(result)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > PRIVACY_BROWSER_MAX_RESPONSE_BYTES) {
    process.stdout.write(`${JSON.stringify({ protocolVersion: 1, requestId: input.requestId, hostname: input.hostname, status: "unknown", code: "privacy_browser_output_too_large" })}\n`);
    return;
  }
  process.stdout.write(serialized);
}

async function readInput(): Promise<string> {
  let content = "";
  for await (const chunk of process.stdin) {
    content += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
    if (Buffer.byteLength(content, "utf8") > MAX_INPUT_BYTES) throw new Error("privacy_browser_request_too_large");
    const newline = content.indexOf("\n");
    if (newline >= 0) return content.slice(0, newline);
  }
  if (!content) throw new Error("privacy_browser_request_empty");
  return content;
}

function parseInput(input: string): PrivacyBrowserInput {
  const value: unknown = JSON.parse(input);
  if (!isRecord(value) || Object.keys(value).length !== (Object.hasOwn(value, "targetUrl") ? 4 : 3) || value.protocolVersion !== 1 ||
      typeof value.requestId !== "string" || !/^[0-9a-f-]{36}$/iu.test(value.requestId) ||
      typeof value.hostname !== "string" || value.hostname.length > 253) {
    throw new Error("privacy_browser_request_invalid");
  }
  if (value.targetUrl !== undefined) {
    const target = parseScanTargetUrl(value.targetUrl);
    if (target.hostname !== value.hostname.toLowerCase()) throw new Error("privacy_browser_request_invalid");
    return { protocolVersion: 1, requestId: value.requestId, hostname: value.hostname, targetUrl: target.targetUrl };
  }
  return { protocolVersion: 1, requestId: value.requestId, hostname: value.hostname };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

void main().catch(() => {
  process.stdout.write(`${JSON.stringify({ protocolVersion: 1, status: "unknown", code: "privacy_browser_runtime_failed" })}\n`);
  process.exitCode = 0;
});
