import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
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
const verifier = pageContents.at(-1);
const styleSources = [
  "desarrollo-seguro/styles.scss",
  "apps/desarrollo-seguro/web/src/public-scan-portal/public-scan-portal.scss",
];
const styles = await Promise.all(styleSources.map((path) => readFile(path, "utf8")));

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
assert.match(methodology, /Metodología|metodología/u);
assert.match(privacy, /Privacidad|privacidad/u);
assert.match(seal, /sello|distintivo/iu);
assert.match(seal, /href="verificar\.html"/u, "seal page links to the public verifier");
assert.match(verifier, /noindex, nofollow/u, "verification tokens are excluded from indexing");
assert.match(verifier, /verificar\.js/u, "verification page loads its local verifier script");
assert.match(verifier, /id="verification-result"/u, "verification page has an accessible result region");
assert.match(seal, /badge-widget\.js/u, "seal page documents the live embeddable widget");
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

process.stdout.write("Public site page policy passed.\n");
