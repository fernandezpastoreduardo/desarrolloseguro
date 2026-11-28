import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { createHttpsFixture } from "./https-fixture.mjs";

function requestFixture(fixture, {
  path = "/",
  protocol = "https:",
  method = "GET",
  host = fixture.hostname,
  servername = fixture.hostname,
  timeoutMs = 5_000,
} = {}) {
  const secure = protocol === "https:";
  const request = (secure ? httpsRequest : httpRequest)({
    hostname: fixture.hostname,
    port: secure ? fixture.httpsPort : fixture.httpPort,
    path,
    method,
    headers: { Host: host },
    ...(secure ? { ca: fixture.certificatePem, servername, rejectUnauthorized: true } : {}),
    lookup(hostname, options, callback) {
      assert.equal(hostname, fixture.hostname, "fixture client may resolve only its run-scoped host");
      if (options?.all) {
        callback(null, [{ address: "127.0.0.1", family: 4 }]);
      } else {
        callback(null, "127.0.0.1", 4);
      }
    },
  });

  return new Promise((resolve, reject) => {
    let body = "";
    let responseHeaders = {};
    let statusCode;
    let timedOut = false;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    request.setTimeout(timeoutMs, () => {
      timedOut = true;
      finish({ statusCode, headers: responseHeaders, body, timedOut });
      request.destroy();
    });
    request.once("response", (response) => {
      statusCode = response.statusCode;
      responseHeaders = response.headers;
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.once("end", () => finish({ statusCode, headers: responseHeaders, body, timedOut }));
    });
    request.once("error", (error) => {
      if (!timedOut) reject(error);
    });
    request.end();
  });
}

test("HTTPS fixture has a unique run host, exact SAN, path and query", async (t) => {
  const runId = randomUUID();
  const fixture = await createHttpsFixture({ runId, httpsPort: 0 });
  t.after(() => fixture.close());

  assert.equal(fixture.runId, runId);
  assert.equal(fixture.hostname, `scan-${runId}.example.net`);
  assert.equal(fixture.listenHost, "127.0.0.1");
  assert.equal(fixture.port, fixture.httpsPort);
  assert.equal(fixture.httpPort, null);
  assert.equal(fixture.httpBaseUrl, null);

  const requestTarget = `/careers?case=normal&run=${runId}`;
  const response = await requestFixture(fixture, { path: requestTarget });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["x-lab-request-target"], requestTarget);
  assert.match(response.headers["content-type"], /text\/html/u);
  assert.match(response.body, /Página de prueba/u);
  assert.doesNotMatch(response.body, /(?:https?:)?\/\//u, "normal fixture page must not load other origins");

  const headResponse = await requestFixture(fixture, { path: requestTarget, method: "HEAD" });
  assert.equal(headResponse.statusCode, response.statusCode);
  assert.equal(headResponse.headers["x-lab-request-target"], requestTarget);
  assert.equal(headResponse.headers["content-length"], String(Buffer.byteLength(response.body)));
  assert.equal(headResponse.body, "");
});

test("consent fixture sets one catalogued cookie only on its exact host", async (t) => {
  const runId = randomUUID();
  const fixture = await createHttpsFixture({ runId, httpsPort: 0 });
  t.after(() => fixture.close());

  const requestTarget = `/consent?phase=initial&run=${runId}`;
  const response = await requestFixture(fixture, { path: requestTarget });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["x-lab-request-target"], requestTarget);
  assert.match(response.headers["set-cookie"][0], new RegExp(`^_ga=lab-${runId};`));
  assert.match(response.headers["set-cookie"][0], /; Secure; SameSite=Lax$/u);
  assert.match(response.body, /id="cookie-consent" class="cookie-consent"/u);
  assert.match(response.body, /href="\/privacy-policy">Política de privacidad/u);
  assert.match(response.body, /Aceptar todas/u);
  assert.match(response.body, /Rechazar no esenciales/u);
  assert.match(response.body, /localStorage\.setItem\("fixture-consent", "accepted"\)/u);
  assert.match(response.body, /localStorage\.setItem\("fixture-consent", "rejected"\)/u);
  assert.match(response.body, /_ga=; Path=\/; Max-Age=0; Secure; SameSite=Lax/u);

  const policyResponse = await requestFixture(fixture, {
    path: `/privacy-policy?run=${runId}`,
  });
  assert.equal(policyResponse.statusCode, 200);
  assert.match(policyResponse.body, /Política de privacidad/u);
  assert.equal(policyResponse.headers["set-cookie"], undefined);

  const headResponse = await requestFixture(fixture, { path: requestTarget, method: "HEAD" });
  assert.equal(headResponse.statusCode, response.statusCode);
  assert.equal(headResponse.headers["set-cookie"][0], response.headers["set-cookie"][0]);
  assert.equal(headResponse.body, "");

  const unexpectedHost = await requestFixture(fixture, {
    path: requestTarget,
    host: "other.example.net",
  });
  assert.equal(unexpectedHost.statusCode, 421);
  assert.equal(unexpectedHost.body, "unexpected_fixture_host");
  assert.equal(unexpectedHost.headers["set-cookie"], undefined);
  await assert.rejects(
    requestFixture(fixture, { path: requestTarget, servername: "other.example.net" }),
    "fixture must reject a TLS connection with an unrelated SNI name",
  );
});

test("optional internal HTTP listener preserves Host and query without redirect or egress", async (t) => {
  const runId = randomUUID();
  const fixture = await createHttpsFixture({ runId, httpsPort: 0, httpPort: 0 });
  t.after(() => fixture.close());

  assert.equal(fixture.listenHost, "127.0.0.1");
  assert.ok(fixture.httpPort > 0);
  assert.equal(fixture.httpBaseUrl, `http://${fixture.hostname}`);
  const requestTarget = `/careers?phase=http&run=${runId}`;
  const response = await requestFixture(fixture, {
    path: requestTarget,
    protocol: "http:",
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers.location, undefined, "fixture must not redirect HTTP to HTTPS");
  assert.equal(response.headers["x-lab-request-target"], requestTarget);
  assert.match(response.body, /Página de prueba/u);
  assert.doesNotMatch(response.body, /(?:https?:)?\/\//u, "fixture page must not request an external origin");

  const headResponse = await requestFixture(fixture, {
    path: requestTarget,
    protocol: "http:",
    method: "HEAD",
  });
  assert.equal(headResponse.statusCode, response.statusCode);
  assert.equal(headResponse.headers["x-lab-request-target"], requestTarget);
  assert.equal(headResponse.body, "");

  const certificatePath = "/__lab/certificate.pem?purpose=internal-trust-bootstrap";
  const certificateResponse = await requestFixture(fixture, {
    path: certificatePath,
    protocol: "http:",
  });
  assert.equal(certificateResponse.statusCode, 200);
  assert.equal(certificateResponse.headers["x-lab-request-target"], certificatePath);
  assert.equal(certificateResponse.body, fixture.certificatePem);
  assert.match(certificateResponse.headers["content-type"], /application\/x-pem-file/u);
});

test("partial fixture exposes page content before a delayed resource times out", async (t) => {
  const runId = randomUUID();
  const fixture = await createHttpsFixture({ runId, httpsPort: 0 });
  t.after(() => fixture.close());

  const pageTarget = `/partial?delayMs=1200&run=${runId}`;
  const pageResponse = await requestFixture(fixture, { path: pageTarget });
  assert.equal(pageResponse.statusCode, 200);
  assert.equal(pageResponse.headers["x-lab-request-target"], pageTarget);
  assert.match(pageResponse.body, /Contenido recibido/u);
  assert.match(pageResponse.body, new RegExp(`/timeout-resource\\?delayMs=1200&runId=${runId}`));

  const resourceTarget = `/timeout-resource?delayMs=1200&runId=${runId}`;
  const headResponse = await requestFixture(fixture, {
    path: resourceTarget,
    method: "HEAD",
    timeoutMs: 100,
  });
  assert.equal(headResponse.statusCode, 200);
  assert.equal(headResponse.timedOut, false);
  assert.equal(headResponse.headers["x-lab-request-target"], resourceTarget);
  assert.equal(headResponse.headers["content-length"], String(Buffer.byteLength("fixture-partial:fixture-complete")));
  assert.equal(headResponse.body, "");

  const resourceResponse = await requestFixture(fixture, {
    path: resourceTarget,
    timeoutMs: 100,
  });
  assert.equal(resourceResponse.timedOut, true);
  assert.match(resourceResponse.body, /^fixture-partial:/u);
  assert.equal(resourceResponse.headers["x-lab-request-target"], resourceTarget);
});

test("fixture rejects reserved host characters and non-loopback/non-container listeners", async () => {
  await assert.rejects(
    createHttpsFixture({ runId: "run.invalid", httpsPort: 0 }),
    { name: "TypeError", message: "public_audit_lab_run_id_invalid" },
  );
  await assert.rejects(
    createHttpsFixture({ runId: "valid-run", listenHost: "192.0.2.1", httpsPort: 0 }),
    { name: "TypeError", message: "public_audit_lab_listen_host_invalid" },
  );
  await assert.rejects(
    createHttpsFixture({ runId: "valid-run", httpsPort: -1 }),
    { name: "TypeError", message: "public_audit_lab_https_port_invalid" },
  );
});
