import assert from "node:assert/strict";
import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyReportBadge } from "../desarrollo-seguro/badge-api.mjs";

const pages = [
  "desarrollo-seguro/index.html",
  "desarrollo-seguro/metodologia.html",
  "desarrollo-seguro/privacidad.html",
  "desarrollo-seguro/sello.html",
  "desarrollo-seguro/verificar.html",
];
const pageContents = await Promise.all(pages.map((path) => readFile(path, "utf8")));
const [home, methodology, privacy, seal] = pageContents;
const verifier = pageContents[4];
const styleSources = [
  "desarrollo-seguro/styles.scss",
  "apps/desarrollo-seguro/web/src/public-scan-portal/public-scan-portal.scss",
];
const styles = await Promise.all(styleSources.map((path) => readFile(path, "utf8")));
const badgeWidgetStyles = await readFile("desarrollo-seguro/badge-widget.scss", "utf8");

for (const [index, html] of pageContents.entries()) {
  assert.match(html, /<html lang="es-ES">/u, `${pages[index]} declares Spanish`);
  assert.match(html, /<main\b/u, `${pages[index]} has a main landmark`);
  assert.match(html, /href="\/app\/"/u, `${pages[index]} links to the app`);
  assert.match(html, /href="\/app\/site\.css"/u, `${pages[index]} loads compiled Sass`);
  assert.match(html, /src="\/desarrollo-seguro\/assets\/desarrollo-seguro-logo-v1\.svg"/u, `${pages[index]} uses the approved local logo`);
  assert.doesNotMatch(html, /brand-mark/u, `${pages[index]} does not use the retired placeholder mark`);
  assert.doesNotMatch(html, /href="\/desarrollo-seguro\/styles\.css"/u);
  assert.doesNotMatch(html, /href="#(?!contenido\b)[^"]+"/u, `${pages[index]} has no section-navigation anchors`);
  assert.match(html, /href="\/desarrollo-seguro\/(?:metodologia|privacidad|sello)\.html"/u, `${pages[index]} has page navigation`);
  assert.doesNotMatch(html, /(?:href|src)="(?:index|metodologia|privacidad|sello|verificar|informe-grumphya-prototipo)\.html|(?:href|src)="assets\//u, `${pages[index]} uses deployable public routes`);
  assert.doesNotMatch(html, /no realiza análisis|no genera resultados|aún no consulta sitios|no ofrece\s+informes operativos|no está activo/u, `${pages[index]} does not claim the scanner is non-operational`);
}

assert.match(home, /href="\/desarrollo-seguro\/metodologia\.html"/u);
assert.match(home, /href="\/desarrollo-seguro\/privacidad\.html"/u);
assert.match(home, /href="\/desarrollo-seguro\/sello\.html"/u);
assert.doesNotMatch(home, /informe-grumphya-prototipo/u, "home page no longer links to the retired prototype report");
assert.match(home, /client-reports/u, "home page shows the current client reports");
assert.match(home, /CERTIFICACIONES PÚBLICAS/u, "home page labels the section as public certifications");
assert.match(home, /Sitios certificados/u, "home page identifies the featured sites as certified");
assert.match(home, /Puedes consultar cualquier URL en el buscador/u, "home page clarifies that search is not limited to certified sites");
assert.match(home, /href="\/app\/\?url=https%3A%2F%2Fgrumphya\.com%2F"/u);
assert.match(home, /href="\/app\/\?url=https%3A%2F%2Fdesarrolloseguro\.org%2F"/u);
assert.match(methodology, /Metodología|metodología/u);
assert.match(privacy, /Privacidad|privacidad/u);
assert.match(seal, /sello|distintivo/iu);
assert.match(seal, /href="\/desarrollo-seguro\/verificar\.html"/u, "seal page links to the public verifier");
assert.match(verifier, /noindex, nofollow/u, "verification tokens are excluded from indexing");
assert.match(verifier, /verificar\.js/u, "verification page loads its local verifier script");
assert.match(verifier, /id="verification-result"/u, "verification page has an accessible result region");
assert.match(verifier, /id="verification-report-summary"/u, "verification page has a report summary region");
assert.match(verifier, /id="verification-categories"/u, "verification page exposes evaluated certification categories");
assert.match(verifier, /id="verification-report-link"/u, "verification page links to the full public report");
assert.match(verifier, /Logotipo de Desarrollo Seguro/u, "verification page shows the approved logo beside authenticity status");
assert.match(seal, /badge-widget\.js/u, "seal page documents the live embeddable widget");
assert.doesNotMatch(seal, /data-report-id/u, "the public embed does not pin the seal to a report that will age out");
for (const html of pageContents.slice(0, 4)) {
  assert.equal((html.match(/<a data-ds-verified-badge/gu) ?? []).length, 1, "each informational page has one dynamic footer badge");
  assert.match(html, /data-hostname="desarrolloseguro\.org"/u, "the footer badge is bound to Desarrollo Seguro");
  assert.match(html, /src="\/desarrollo-seguro\/badge-widget\.js"/u, "the footer loads the same-origin badge widget");
  assert.match(html, /script-src 'self';[\s\S]*?img-src 'self'; connect-src 'self'/u, "footer badge capabilities are narrowly declared in CSP");
}
assert.doesNotMatch(verifier, /data-ds-verified-badge/u, "the verifier page does not show a self-referential badge");
await assert.rejects(access("desarrollo-seguro/informe-grumphya-prototipo.html"), { code: "ENOENT" });
await assert.rejects(access("desarrollo-seguro/informe-grumphya-prototipo.scss"), { code: "ENOENT" });
assert.match(verifier, /no-referrer/u, "verification links do not leak tokens through referrers");
assert.match(styles[0], /\$navy:\s*#/u, "the public site uses Sass design tokens");
assert.match(styles[1], /\$ds-teal:\s*#/u, "the app uses Sass design tokens");
assert.match(styles[0], /\.verification-panel\[data-state="valid"\]/u, "verification result has a distinct visual approval state");
assert.match(badgeWidgetStyles, /\.ds-verified-badge__logo/u, "the embedded approval seal styles its logo");
for (const obsoleteCss of [
  "desarrollo-seguro/styles.css",
  "apps/desarrollo-seguro/web/src/public-scan-portal/public-scan-portal.css",
]) {
  await assert.rejects(access(obsoleteCss), { code: "ENOENT" });
}

const reportId = "8d140e17-68d6-489a-b451-7e87408187ae";
const verifierScript = await readFile("desarrollo-seguro/verificar.js", "utf8");
assert.match(verifierScript, /history\.replaceState\(null, "", `\$\{window\.location\.pathname\}\$\{window\.location\.search\}`\)/u, "verification removes the bearer token fragment from browser history");
assert.match(verifierScript, /Sello auténtico y vigente/u, "verification reports a successful authenticity check");
assert.match(verifierScript, /fetchPublicReport\(result\.reportId\)/u, "verification loads the report summary after authenticity succeeds");
assert.match(verifierScript, /reportLink\.hidden = true/u, "verification hides the report link after an authenticity failure");
assert.match(verifierScript, /REPORT_API_PATH = "\/api\/desarrollo-seguro\/v1\/reports"/u, "report details use the same-origin public API");
const portalScript = await readFile(
  "apps/desarrollo-seguro/web/src/public-scan-portal/public-scan-portal.tsx",
  "utf8",
);
assert.match(portalScript, /new URLSearchParams\(window\.location\.search\)\.get\("report"\)/u);
assert.match(portalScript, /new URLSearchParams\(window\.location\.search\)\.get\("url"\)/u, "the public portal accepts a complete URL deep link");
assert.match(portalScript, /else if \(targetUrl\) void loadTargetStatus\(targetUrl\)/u, "deep links use the existing public status read");
assert.match(
  verifierScript,
  /reportLink\.href = `\/app\/\?report=\$\{encodeURIComponent\(result\.reportId\)\}`/u,
  "verified badges open the report using the public portal's query parameter",
);
assert.doesNotMatch(verifierScript, /\/app\/#report=/u);

let observedRequests = [];
const currentReportId = "9193860a-3e3b-4ce1-a871-1624ea98301b";
const statusResponse = (hostname, state = "fresh", certificationState = "active", reportId = currentReportId) => ({
  state,
  hostname,
  lastReport: { certification: { state: certificationState, certifiedReportId: reportId } },
});
const validResult = await verifyReportBadge(
  { token: "A".repeat(43), hostname: "grumphya.com", reportId: "6bff5c3e-ff99-4f68-bfe9-fb5f5dfb2823" },
  async (url, options) => {
    observedRequests.push({ url, options });
    return {
      ok: true,
      json: async () => url.endsWith("/status")
        ? statusResponse("grumphya.com")
        : { verified: true, hostname: "grumphya.com", canonicalHostname: "grumphya.com", reportId: currentReportId },
    };
  },
);
assert.deepEqual(validResult, { verified: true, hostname: "grumphya.com", reportId: currentReportId });
assert.equal(observedRequests.length, 2);
assert.equal(observedRequests[0].options.method, "GET");
assert.equal(observedRequests[0].options.cache, "no-store");
assert.equal(observedRequests[0].url, "https://desarrolloseguro.org/api/desarrollo-seguro/v1/domains/grumphya.com/status");
assert.equal(observedRequests[1].options.cache, "no-store");
assert.equal(observedRequests[1].options.method, "POST");
assert.equal(observedRequests[1].url, "https://desarrolloseguro.org/api/desarrollo-seguro/v1/badges/verify");
assert.equal(observedRequests[1].options.body, JSON.stringify({ token: "A".repeat(43), hostname: "grumphya.com", reportId: currentReportId }));
assert.doesNotMatch(observedRequests[1].url, /A{43}/u, "verification tokens stay out of URL and access logs");
const failClosed = await verifyReportBadge(
  { token: "A".repeat(43), hostname: "grumphya.com", reportId },
  async () => { throw new Error("offline"); },
);
assert.equal(failClosed.verified, false);
assert.equal(failClosed.code, "network_failure");
const stalledJson = await verifyReportBadge(
  { token: "A".repeat(43), hostname: "grumphya.com" },
  async (_url, { signal }) => ({
    ok: true,
    json: () => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("response_body_timeout")), { once: true });
    }),
  }),
  5,
);
assert.equal(stalledJson.verified, false, "stalled JSON bodies fail closed");
assert.equal(stalledJson.code, "network_failure", "the request timeout remains active while parsing JSON");
let verificationPosted = false;
const inactiveResult = await verifyReportBadge(
  { token: "A".repeat(43), hostname: "grumphya.com" },
  async (url) => {
    if (!url.endsWith("/status")) verificationPosted = true;
    return { ok: true, json: async () => statusResponse("grumphya.com", "fresh", "suspended") };
  },
);
assert.deepEqual(inactiveResult, { verified: false, code: "report_not_current", hostname: "grumphya.com", reportId: "No indicado" });
assert.equal(verificationPosted, false, "inactive certification never reaches the verification POST");
const staleResult = await verifyReportBadge(
  { token: "A".repeat(43), hostname: "grumphya.com" },
  async (url) => ({
    ok: true,
    json: async () => url.endsWith("/status") ? statusResponse("grumphya.com", "stale") : {},
  }),
);
assert.equal(staleResult.code, "report_not_current");
const aliasResult = await verifyReportBadge(
  { token: "A".repeat(43), hostname: "www.grumphya.com", reportId },
  async (_url, options) => {
    return {
      ok: true,
      json: async () => options.method === "GET"
        ? statusResponse("www.grumphya.com", "updating")
        : { verified: true, hostname: "grumphya.com", canonicalHostname: "grumphya.com", reportId: currentReportId },
    };
  },
);
assert.deepEqual(aliasResult, { verified: true, hostname: "grumphya.com", reportId: currentReportId });
const mismatchedReport = await verifyReportBadge(
  { token: "A".repeat(43), hostname: "grumphya.com", reportId },
  async (url) => ({
    ok: true,
    json: async () => url.endsWith("/status")
      ? statusResponse("grumphya.com")
      : { verified: true, hostname: "grumphya.com", reportId: "different" },
  }),
);
assert.equal(mismatchedReport.verified, false);
assert.equal(mismatchedReport.code, "report_not_current");
const widgetScript = await readFile("desarrollo-seguro/badge-widget.js", "utf8");
assert.doesNotMatch(widgetScript, /innerHTML/u);
assert.match(widgetScript, /mode: "cors"/u);
assert.match(widgetScript, /method: "POST"/u);
assert.match(widgetScript, /certifiedReportId/u, "the widget resolves the current certified report instead of trusting a baked-in ID");
assert.doesNotMatch(widgetScript, /dataset\.reportId/u, "a stale report ID from the embedding page is ignored");
assert.match(widgetScript, /method: "GET"/u);
assert.match(widgetScript, /cache: "no-store"/u);
assert.match(widgetScript, /async function fetchJsonWithTimeout[\s\S]*?await response\.json\(\)[\s\S]*?clearTimeout\(timeout\)/u, "widget request timeout covers response-body parsing");
assert.match(widgetScript, /widget\.hidden = false/u, "badge link is exposed only after server verification");
assert.match(widgetScript, /widget\.dataset\.diagnostic = result\.code[\s\S]*?widget\.hidden = true/u, "failed verification keeps the dynamic seal hidden while retaining a safe diagnostic");
assert.match(widgetScript, /createBrandLogo\(/u, "the verified badge displays the approved brand logo");
assert.match(widgetScript, /createElement\("style"\)/u, "the widget applies its build-time Sass styles under the host CSP");
assert.match(badgeWidgetStyles, /width:\s*min\(270px,\s*100%\)/u, "the compact badge stays within a narrow footer column");
assert.match(widgetScript, /Beta activa/u, "the badge summarizes current beta approval");
assert.match(widgetScript, /"desarrolloseguro\.org"/u, "the widget authorizes the Desarrollo Seguro identity");

async function executeBadgeWidget(state, certificationState, verificationResult, settings = {}) {
  class TestElement {
    constructor(tagName = "a") {
      this.tagName = tagName;
      this.children = [];
      this.attributes = new Map();
      this.className = "";
      this.dataset = {};
      this.classList = { add: (className) => { this.className = `${this.className} ${className}`.trim(); } };
    }

    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { this.attributes.set(name, value); }
    addEventListener() {}
  }
  class TestAnchor extends TestElement {
    constructor() {
      super("a");
      this.dataset = {
        token: "A".repeat(43),
        hostname: settings.hostname ?? "grumphya.com",
        reportId: "6bff5c3e-ff99-4f68-bfe9-fb5f5dfb2823",
      };
      this.hidden = false;
      this.href = "";
      this.textContent = "";
    }
  }
  const anchor = new TestAnchor();
  const requests = [];
  const executableScript = widgetScript.replace(
    "const BADGE_REQUEST_TIMEOUT_MS = 10_000;",
    `const BADGE_REQUEST_TIMEOUT_MS = ${settings.timeoutMs ?? 10_000};`,
  );
  const context = {
    document: { querySelectorAll: () => [anchor], createElement: (tagName) => new TestElement(tagName) },
    window: { location: { hostname: settings.browserHostname ?? settings.hostname ?? "grumphya.com" } },
    HTMLAnchorElement: TestAnchor,
    URLSearchParams,
    URL: { createObjectURL: () => "blob:development-seguro-logo", revokeObjectURL() {} },
    Blob,
    AbortController,
    setTimeout,
    clearTimeout,
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (settings.stallJson === true) {
        return {
          ok: true,
          json: async () => new Promise((_resolve, reject) => {
            options.signal.addEventListener("abort", () => reject(new Error("response_body_timeout")), { once: true });
          }),
        };
      }
      return {
        ok: true,
        json: async () => options.method === "GET"
          ? statusResponse(settings.hostname ?? "grumphya.com", state, certificationState)
          : verificationResult,
      };
    },
  };
  runInNewContext(executableScript, context);
  await new Promise((resolve) => setTimeout(resolve, settings.stallJson ? settings.timeoutMs + 5 : 0));
  return { anchor, requests };
}

const renderedBadge = await executeBadgeWidget("fresh", "active", {
  verified: true,
  hostname: "grumphya.com",
  canonicalHostname: "grumphya.com",
  reportId: currentReportId,
});
const renderedSelfBadge = await executeBadgeWidget("fresh", "active", {
  verified: true,
  hostname: "desarrolloseguro.org",
  canonicalHostname: "desarrolloseguro.org",
  reportId: currentReportId,
}, { hostname: "desarrolloseguro.org" });
assert.equal(renderedSelfBadge.anchor.hidden, false, "the widget can reveal the self-domain badge after server verification");
assert.equal(renderedSelfBadge.anchor.children[0].src, "/desarrollo-seguro/assets/desarrollo-seguro-logo-v1.svg", "the same-origin badge logo stays within img-src self");
assert.equal(renderedBadge.anchor.hidden, false, "the live widget appears for the current active report");
assert.equal(renderedBadge.anchor.dataset.state, "valid");
const stalledBadge = await executeBadgeWidget("fresh", "active", {}, { timeoutMs: 5, stallJson: true });
assert.equal(stalledBadge.anchor.hidden, true, "a stalled status response eventually leaves the widget safely hidden");
assert.equal(stalledBadge.anchor.dataset.diagnostic, "network_failure");
assert.match(renderedBadge.anchor.href, new RegExp(`reportId=${currentReportId}`, "u"));
assert.match(renderedBadge.anchor.className, /ds-verified-badge/u);
assert.equal(renderedBadge.anchor.children[0].tagName, "img");
assert.equal(renderedBadge.anchor.children[0].src, "blob:development-seguro-logo");
assert.match(renderedBadge.anchor.children[1].children[0].textContent, /Sello aprobado/u);
assert.equal(JSON.parse(renderedBadge.requests[1].options.body).reportId, currentReportId, "the old embedded ID is replaced with the current one");
const hiddenBadge = await executeBadgeWidget("stale", "active", { verified: false, code: "report_not_current" });
assert.equal(hiddenBadge.requests.length, 1, "a stale report is rejected before verification");
assert.equal(hiddenBadge.anchor.hidden, true, "an invalid or stale seal remains visually absent");
assert.equal(hiddenBadge.anchor.textContent, "", "failed verification does not replace the badge with an error notice");

const buildDirectory = await mkdtemp(join(tmpdir(), "development-security-site-build-"));
try {
  const build = spawnSync(
    process.execPath,
    [
      "apps/desarrollo-seguro/web/scripts/build-public-site-assets.mjs",
      "--output-dir",
      buildDirectory,
    ],
    { encoding: "utf8" },
  );
  assert.equal(build.status, 0, build.stderr || build.stdout);
  const generatedHome = await readFile(join(buildDirectory, "desarrollo-seguro/index.html"), "utf8");
  const stylesheetPath = generatedHome.match(/href="(\/app\/assets\/site-[a-f0-9]{16}\.css)"/u)?.[1];
  assert.ok(stylesheetPath, "generated pages reference a fingerprinted stylesheet");
  const stylesheet = await readFile(join(buildDirectory, stylesheetPath.replace(/^\/app\//u, "")), "utf8");
  const stylesheetHash = createHash("sha256").update(stylesheet).digest("hex").slice(0, 16);
  assert.equal(stylesheetPath, `/app/assets/site-${stylesheetHash}.css`);
  assert.equal(await readFile(join(buildDirectory, "site.css"), "utf8"), stylesheet);
  for (const page of pages.slice(1)) {
    const generatedPage = await readFile(join(buildDirectory, page), "utf8");
    assert.match(generatedPage, new RegExp(`href="/app/assets/site-${stylesheetHash}\\.css"`, "u"));
  }
  await assert.rejects(access(join(buildDirectory, "desarrollo-seguro/informe-grumphya-prototipo.html")), { code: "ENOENT" });
  const builtAssets = await readFile(join(buildDirectory, "desarrollo-seguro/assets/grumphya-mascot-isotype.svg"), "utf8");
  assert.match(builtAssets, /<svg\b/u, "the Grumphya brand mark is bundled locally");
  const assetFiles = await readdir(join(buildDirectory, "assets"));
  await access(join(buildDirectory, "desarrollo-seguro/assets/fonts/Fredoka-Variable-latin.woff2"));
  await access(join(buildDirectory, "desarrollo-seguro/assets/fonts/Fredoka-OFL.txt"));
  assert.doesNotMatch(assetFiles.join("\n"), /prototype-report/u, "the retired prototype stylesheet is absent from the public build");
  const generatedVerifier = await readFile(join(buildDirectory, "desarrollo-seguro/verificar.html"), "utf8");
  const verifierTag = generatedVerifier.match(/<script\b[^>]*src="\/desarrollo-seguro\/verificar\.js"[^>]*>/u)?.[0];
  assert.ok(verifierTag?.includes('integrity="sha256-'), "the verification page pins its script with SRI");
  const verifierSource = await readFile(join(buildDirectory, "desarrollo-seguro/verificar.js"));
  const verifierHash = createHash("sha256").update(verifierSource).digest("base64");
  assert.ok(verifierTag.includes(`integrity="sha256-${verifierHash}"`), "the SRI digest matches the published script bytes");
  assert.match(verifierSource.toString("utf8"), /async function verifyReportBadge/u, "the verifier bundles its reviewed helper module");
  assert.doesNotMatch(verifierSource.toString("utf8"), /^import\s/mu, "the CSP-protected verification entry has no unpinned module imports");
  const generatedCsp = await readFile(join(buildDirectory, "nginx-security-headers.conf"), "utf8");
  assert.ok(generatedCsp.includes(`'sha256-${verifierHash}'`) && generatedCsp.includes("'strict-dynamic'"));
  assert.doesNotMatch(generatedCsp, /script-src[^;]*'self'/u, "the generated script policy does not authorize by host");
  await access(join(buildDirectory, "desarrollo-seguro/badge-widget.js"));
  await access(join(buildDirectory, "desarrollo-seguro/verificar.js"));
  await access(join(buildDirectory, "desarrollo-seguro/assets/desarrollo-seguro-logo-v1.svg"));
  const builtWidget = await readFile(join(buildDirectory, "desarrollo-seguro/badge-widget.js"), "utf8");
  assert.doesNotMatch(builtWidget, /const BADGE_WIDGET_(?:STYLES|LOGO_SVG) = "__DS_BADGE_WIDGET_/u, "the build injects Sass and the approved logo into the standalone widget");
  assert.match(builtWidget, /\.ds-verified-badge__logo/u, "the public widget ships with its compiled SCSS");
  assert.match(builtWidget, /<svg xmlns=/u, "the public widget contains the approved SVG needed by restrictive img-src policies");
} finally {
  await rm(buildDirectory, { recursive: true, force: true });
}

process.stdout.write("Public site page and asset-version policy passed.\n");
