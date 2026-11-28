import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { createSecureContext } from "node:tls";
import { URL } from "node:url";
import { randomUUID } from "node:crypto";

const MAX_DELAY_MS = 10_000;
const MAX_REQUEST_TARGET_LENGTH = 4_096;
const ALLOWED_LISTEN_HOSTS = new Set(["127.0.0.1", "0.0.0.0"]);

function validateRunId(runId) {
  if (typeof runId !== "string" || !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,46}[a-zA-Z0-9])?$/.test(runId)) {
    throw new TypeError("public_audit_lab_run_id_invalid");
  }
  return runId.toLowerCase();
}

function getHostname(runId) {
  return `scan-${runId}.example.net`;
}

function runOpenSsl(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("openssl", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-2_000);
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`public_audit_lab_certificate_failed:${code ?? signal}:${stderr}`));
    });
  });
}

async function createCertificate(hostname, directory) {
  const keyPath = join(directory, "fixture.key");
  const certificatePath = join(directory, "fixture.crt");
  await runOpenSsl([
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    keyPath,
    "-out",
    certificatePath,
    "-days",
    "1",
    "-subj",
    `/CN=${hostname}`,
    "-addext",
    `subjectAltName=DNS:${hostname}`,
  ]);
  await chmod(keyPath, 0o600);
  const [key, certificatePem] = await Promise.all([
    readFile(keyPath),
    readFile(certificatePath, "utf8"),
  ]);
  return { key, certificatePem };
}

function htmlResponse(response, body, requestTarget, extraHeaders = {}, method = "GET") {
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
    "X-Content-Type-Options": "nosniff",
    "X-Lab-Request-Target": requestTarget,
    ...extraHeaders,
  });
  response.end(method === "HEAD" ? undefined : body);
}

function textResponse(response, statusCode, body, method = "GET") {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(method === "HEAD" ? undefined : body);
}

function fixtureRequestHandler(hostname, pendingTimers, certificatePem) {
  return (request, response) => {
    const requestTarget = request.url ?? "/";
    const requestHost = request.headers.host?.split(":", 1)[0]?.toLowerCase();
    if (requestHost !== hostname) {
      textResponse(response, 421, "unexpected_fixture_host", request.method);
      return;
    }
    if (!["GET", "HEAD"].includes(request.method ?? "") || requestTarget.length > MAX_REQUEST_TARGET_LENGTH) {
      textResponse(response, 400, "invalid_fixture_request", request.method);
      return;
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(requestTarget, `https://${hostname}`);
    } catch {
      textResponse(response, 400, "invalid_fixture_request_target", request.method);
      return;
    }
    if (parsedUrl.origin !== `https://${hostname}`) {
      textResponse(response, 400, "invalid_fixture_request_target", request.method);
      return;
    }

    if (parsedUrl.pathname === "/__lab/certificate.pem") {
      response.writeHead(200, {
        "Content-Type": "application/x-pem-file",
        "Cache-Control": "no-store",
        "Content-Length": Buffer.byteLength(certificatePem),
        "X-Lab-Request-Target": requestTarget,
      });
      response.end(request.method === "HEAD" ? undefined : certificatePem);
      return;
    }

    if (parsedUrl.pathname === "/consent") {
      const consentPage = `<!doctype html><html lang="es"><meta charset="utf-8"><title>Preferencias de cookies</title><body><main id="cookie-consent" class="cookie-consent"><h1>Preferencias de cookies</h1><p>Cookies analíticas de Google Analytics</p><a href="/privacy-policy">Política de privacidad</a><button id="accept" type="button">Aceptar todas</button><button id="reject" type="button">Rechazar no esenciales</button></main><script>
        document.querySelector("#accept").addEventListener("click", () => {
          localStorage.setItem("fixture-consent", "accepted");
          document.querySelector("#cookie-consent").remove();
        });
        document.querySelector("#reject").addEventListener("click", () => {
          localStorage.setItem("fixture-consent", "rejected");
          document.cookie = "_ga=; Path=/; Max-Age=0; Secure; SameSite=Lax";
          document.querySelector("#cookie-consent").remove();
        });
      </script></body></html>`;
      htmlResponse(
        response,
        consentPage,
        requestTarget,
        { "Set-Cookie": `_ga=lab-${hostname.slice(5, -12)}; Path=/; Max-Age=3600; Secure; SameSite=Lax` },
        request.method,
      );
      return;
    }

    if (parsedUrl.pathname === "/privacy-policy") {
      htmlResponse(
        response,
        "<!doctype html><html lang=\"es\"><meta charset=\"utf-8\"><title>Política de privacidad</title><body><main><h1>Política de privacidad</h1><p>Se usan cookies analíticas de Google Analytics.</p></main></body></html>",
        requestTarget,
        {},
        request.method,
      );
      return;
    }

    if (parsedUrl.pathname === "/partial") {
      const delayMs = parseDelay(parsedUrl.searchParams.get("delayMs"));
      const slowResource = `/timeout-resource?delayMs=${delayMs}&runId=${encodeURIComponent(hostname.slice(5, -12))}`;
      htmlResponse(
        response,
        `<!doctype html><html lang="es"><meta charset="utf-8"><title>Respuesta parcial</title><body><main><h1>Contenido recibido</h1><p>La página respondió antes de que terminara un recurso.</p><img alt="Recurso demorado de laboratorio" src="${slowResource}"></main></body></html>`,
        requestTarget,
        {},
        request.method,
      );
      return;
    }

    if (parsedUrl.pathname === "/timeout-resource") {
      const delayMs = parseDelay(parsedUrl.searchParams.get("delayMs"));
      const resourceBody = "fixture-partial:fixture-complete";
      response.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Length": Buffer.byteLength(resourceBody),
        "X-Lab-Request-Target": requestTarget,
      });
      if (request.method === "HEAD") {
        response.end();
        return;
      }
      response.write("fixture-partial:");
      const timer = setTimeout(() => {
        pendingTimers.delete(timer);
        if (!response.destroyed) response.end("fixture-complete");
      }, delayMs);
      pendingTimers.add(timer);
      response.once("close", () => {
        clearTimeout(timer);
        pendingTimers.delete(timer);
      });
      return;
    }

    htmlResponse(
      response,
      `<!doctype html><html lang="es"><meta charset="utf-8"><title>Laboratorio público</title><body><main><h1>Página de prueba</h1><p data-run-id="${hostname.slice(5, -12)}">Respuesta normal del fixture.</p></main></body></html>`,
      requestTarget,
      {},
      request.method,
    );
  };
}

function parseDelay(value) {
  if (value === null || !/^\d{1,5}$/.test(value)) return 1_000;
  return Math.min(Math.max(Number(value), 250), MAX_DELAY_MS);
}

/**
 * Creates one self-contained HTTPS target for the isolated public-audit lab.
 * The fixture never makes outbound requests and rejects requests for other hosts.
 * Use 0.0.0.0 only inside the lab container attached to its internal-only network.
 */
export async function createHttpsFixture({
  runId = randomUUID(),
  listenHost = "127.0.0.1",
  httpsPort = 8443,
  httpPort = null,
  privateKeyPem,
  certificatePem: suppliedCertificatePem,
} = {}) {
  const safeRunId = validateRunId(runId);
  if (!ALLOWED_LISTEN_HOSTS.has(listenHost)) {
    throw new TypeError("public_audit_lab_listen_host_invalid");
  }
  if (!Number.isInteger(httpsPort) || httpsPort < 0 || httpsPort > 65_535) {
    throw new TypeError("public_audit_lab_https_port_invalid");
  }
  if (httpPort !== null && (!Number.isInteger(httpPort) || httpPort < 0 || httpPort > 65_535)) {
    throw new TypeError("public_audit_lab_http_port_invalid");
  }

  const hostname = getHostname(safeRunId);
  const hasPrivateKey = privateKeyPem !== undefined;
  const hasCertificate = suppliedCertificatePem !== undefined;
  if (hasPrivateKey !== hasCertificate) {
    throw new TypeError("public_audit_lab_certificate_pair_invalid");
  }
  const certificateDirectory = hasPrivateKey
    ? null
    : await mkdtemp(join(tmpdir(), `ds-audit-lab-${safeRunId}-`));
  let httpsServer;
  let httpServer;
  try {
    const generated = hasPrivateKey
      ? null
      : await createCertificate(hostname, certificateDirectory);
    const key = hasPrivateKey ? Buffer.from(privateKeyPem) : generated.key;
    const certificatePem = hasCertificate ? suppliedCertificatePem : generated.certificatePem;
    const secureContext = createSecureContext({ key, cert: certificatePem });
    const pendingTimers = new Set();
    httpsServer = createHttpsServer({
      key,
      cert: certificatePem,
      SNICallback(servername, callback) {
        if (servername !== hostname) {
          callback(new Error("public_audit_lab_sni_mismatch"));
          return;
        }
        callback(null, secureContext);
      },
    }, fixtureRequestHandler(hostname, pendingTimers, certificatePem));

    await new Promise((resolve, reject) => {
      httpsServer.once("error", reject);
      httpsServer.listen(httpsPort, listenHost, resolve);
    });
    const httpsAddress = httpsServer.address();
    if (!httpsAddress || typeof httpsAddress === "string") {
      throw new Error("public_audit_lab_https_address_unavailable");
    }

    let boundHttpPort = null;
    if (httpPort !== null) {
      httpServer = createHttpServer(fixtureRequestHandler(hostname, pendingTimers, certificatePem));
      await new Promise((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(httpPort, listenHost, resolve);
      });
      const httpAddress = httpServer.address();
      if (!httpAddress || typeof httpAddress === "string") {
        throw new Error("public_audit_lab_http_address_unavailable");
      }
      boundHttpPort = httpAddress.port;
    }

    let closed = false;
    return {
      runId: safeRunId,
      hostname,
      listenHost,
      port: httpsAddress.port,
      httpsPort: httpsAddress.port,
      httpPort: boundHttpPort,
      certificatePem,
      baseUrl: `https://${hostname}`,
      httpBaseUrl: boundHttpPort === null ? null : `http://${hostname}`,
      async close() {
        if (closed) return;
        closed = true;
        for (const timer of pendingTimers) clearTimeout(timer);
        pendingTimers.clear();
        await Promise.all([httpsServer, httpServer].filter(Boolean).map(closeServer));
        if (certificateDirectory) await rm(certificateDirectory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await Promise.all([httpsServer, httpServer].filter(Boolean).map(closeServer));
    if (certificateDirectory) await rm(certificateDirectory, { recursive: true, force: true });
    throw error;
  }
}

function closeServer(server) {
  if (!server.listening) return Promise.resolve();
  server.closeAllConnections();
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}
