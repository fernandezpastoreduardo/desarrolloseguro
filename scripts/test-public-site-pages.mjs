import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyReportBadge } from "../desarrollo-seguro/badge-api.mjs";

const pages = [
  "desarrollo-seguro/index.html",
  "desarrollo-seguro/metodologia.html",
  "desarrollo-seguro/privacidad.html",
  "desarrollo-seguro/sello.html",
  "desarrollo-seguro/verificar.html",
  "desarrollo-seguro/informe-grumphya-prototipo.html",
];
const pageContents = await Promise.all(pages.map((path) => readFile(path, "utf8")));
const [home, methodology, privacy, seal] = pageContents;
const verifier = pageContents[4];
const styleSources = [
  "desarrollo-seguro/styles.scss",
  "apps/desarrollo-seguro/web/src/public-scan-portal/public-scan-portal.scss",
];
const styles = await Promise.all(styleSources.map((path) => readFile(path, "utf8")));
const prototypeStyles = await readFile("desarrollo-seguro/informe-grumphya-prototipo.scss", "utf8");

for (const [index, html] of pageContents.entries()) {
  assert.match(html, /<html lang="es-ES">/u, `${pages[index]} declares Spanish`);
  assert.match(html, /<main\b/u, `${pages[index]} has a main landmark`);
  assert.match(html, /href="\/app\/"/u, `${pages[index]} links to the app`);
  assert.match(html, /href="\/app\/site\.css"/u, `${pages[index]} loads compiled Sass`);
  assert.doesNotMatch(html, /href="\/desarrollo-seguro\/styles\.css"/u);
  assert.doesNotMatch(html, /href="#(?!contenido\b)[^"]+"/u, `${pages[index]} has no section-navigation anchors`);
  assert.match(html, /href="(?:\.\/)?(?:index|metodologia|privacidad|sello)\.html"/u, `${pages[index]} has page navigation`);
  assert.doesNotMatch(html, /no realiza análisis|no genera resultados|aún no consulta sitios|no ofrece\s+informes operativos|no está activo/u, `${pages[index]} does not claim the scanner is non-operational`);
}

assert.match(home, /href="metodologia\.html"/u);
assert.match(home, /href="privacidad\.html"/u);
assert.match(home, /href="sello\.html"/u);
assert.match(home, /href="informe-grumphya-prototipo\.html"/u, "home page links to the Grumphya prototype report");
assert.match(methodology, /Metodología|metodología/u);
assert.match(privacy, /Privacidad|privacidad/u);
assert.match(seal, /sello|distintivo/iu);
assert.match(seal, /href="verificar\.html"/u, "seal page links to the public verifier");
assert.match(verifier, /noindex, nofollow/u, "verification tokens are excluded from indexing");
assert.match(verifier, /verificar\.js/u, "verification page loads its local verifier script");
assert.match(verifier, /id="verification-result"/u, "verification page has an accessible result region");
assert.match(seal, /badge-widget\.js/u, "seal page documents the live embeddable widget");
const prototypeReport = pageContents.at(-1);
assert.match(prototypeReport, /FICHA PROTOTIPO/u);
assert.match(prototypeReport, /64\/100/u, "prototype preserves the score shown in the supplied historical report");
assert.match(prototypeReport, /4 de 8 criterios/u);
assert.match(prototypeReport, /Ética/u);
assert.match(prototypeReport, /Privacidad/u);
assert.match(prototypeReport, /Seguridad/u);
assert.match(prototypeReport, /Rendimiento/u);
assert.match(prototypeReport, /no es un análisis actual/u);
assert.match(prototypeStyles, /\.prototype-summary/u, "prototype report styling is maintained in Sass");
assert.match(verifier, /no-referrer/u, "verification links do not leak tokens through referrers");
assert.match(styles[0], /\$navy:\s*#/u, "the public site uses Sass design tokens");
assert.match(styles[1], /\$ds-coral:\s*#/u, "the app uses Sass design tokens");
for (const obsoleteCss of [
  "desarrollo-seguro/styles.css",
  "apps/desarrollo-seguro/web/src/public-scan-portal/public-scan-portal.css",
]) {
  await assert.rejects(access(obsoleteCss), { code: "ENOENT" });
}

const reportId = "8d140e17-68d6-489a-b451-7e87408187ae";
const verifierScript = await readFile("desarrollo-seguro/verificar.js", "utf8");
const portalScript = await readFile(
  "apps/desarrollo-seguro/web/src/public-scan-portal/public-scan-portal.tsx",
  "utf8",
);
assert.match(portalScript, /new URLSearchParams\(window\.location\.search\)\.get\("report"\)/u);
assert.match(
  verifierScript,
  /reportLink\.href = `\/app\/\?report=\$\{encodeURIComponent\(result\.reportId\)\}`/u,
  "verified badges open the report using the public portal's query parameter",
);
assert.doesNotMatch(verifierScript, /\/app\/#report=/u);

let observedRequest;
const validResult = await verifyReportBadge(
  { token: "A".repeat(43), hostname: "grumphya.com", reportId },
  async (url, options) => {
    observedRequest = { url, options };
    return { ok: true, json: async () => ({ verified: true, hostname: "grumphya.com", reportId }) };
  },
);
assert.deepEqual(validResult, { verified: true, hostname: "grumphya.com", reportId });
assert.equal(observedRequest.options.cache, "no-store");
assert.equal(observedRequest.options.method, "POST");
assert.equal(observedRequest.url, "https://desarrolloseguro.org/api/desarrollo-seguro/v1/badges/verify");
assert.equal(observedRequest.options.body, JSON.stringify({ token: "A".repeat(43), hostname: "grumphya.com", reportId }));
assert.doesNotMatch(observedRequest.url, /A{43}/u, "verification tokens stay out of URL and access logs");
const failClosed = await verifyReportBadge(
  { token: "A".repeat(43), hostname: "grumphya.com", reportId },
  async () => { throw new Error("offline"); },
);
assert.equal(failClosed.verified, false);
const mismatchedReport = await verifyReportBadge(
  { token: "A".repeat(43), hostname: "grumphya.com", reportId },
  async () => ({ ok: true, json: async () => ({ verified: true, hostname: "grumphya.com", reportId: "different" }) }),
);
assert.equal(mismatchedReport.verified, false);
const widgetScript = await readFile("desarrollo-seguro/badge-widget.js", "utf8");
assert.doesNotMatch(widgetScript, /innerHTML/u);
assert.match(widgetScript, /mode: "cors"/u);
assert.match(widgetScript, /method: "POST"/u);
assert.match(widgetScript, /cache: "no-store"/u);
assert.match(widgetScript, /widget\.hidden = false/u, "badge link is exposed only after server verification");
assert.match(widgetScript, /widget\.textContent/u, "badge content is never parsed as markup");

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
  const generatedPrototype = await readFile(join(buildDirectory, pages.at(-1)), "utf8");
  const reportStylesheet = generatedPrototype.match(/href="(\/app\/assets\/prototype-report-[a-f0-9]{16}\.css)"/u)?.[1];
  assert.ok(reportStylesheet, "prototype page references a fingerprinted Sass stylesheet");
  const prototypeCss = await readFile(join(buildDirectory, reportStylesheet.replace(/^\/app\//u, "")), "utf8");
  const prototypeHash = createHash("sha256").update(prototypeCss).digest("hex").slice(0, 16);
  assert.equal(reportStylesheet, `/app/assets/prototype-report-${prototypeHash}.css`);
  await access(join(buildDirectory, "desarrollo-seguro/badge-widget.js"));
  await access(join(buildDirectory, "desarrollo-seguro/verificar.js"));
} finally {
  await rm(buildDirectory, { recursive: true, force: true });
}

process.stdout.write("Public site page and asset-version policy passed.\n");
