import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as sass from "sass";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../../../..");
const sourcePath = resolve(repositoryRoot, "desarrollo-seguro/styles.scss");
const defaultOutputDirectory = resolve(scriptDirectory, "../dist");
const htmlPages = [
  "index.html",
  "metodologia.html",
  "privacidad.html",
  "politica-de-privacidad.html",
  "sello.html",
  "verificar.html",
];
const publicScripts = ["badge-widget.js", "first-entry-notice.js", "verificar.js"];
const publicAssets = [
  "assets/desarrollo-seguro-logo-v1.svg",
  "assets/grumphya-mascot-isotype.svg",
  "assets/fonts/Fredoka-Variable-latin.woff2",
  "assets/fonts/Fredoka-OFL.txt",
];
const badgeWidgetStylesPath = resolve(repositoryRoot, "desarrollo-seguro/badge-widget.scss");
const badgeWidgetLogoPath = resolve(repositoryRoot, "desarrollo-seguro/assets/desarrollo-seguro-logo-v1.svg");

export async function buildPublicSiteAssets(outputDirectory = defaultOutputDirectory) {
  const { css } = sass.compile(sourcePath, { style: "compressed", sourceMap: false });
  const { css: badgeWidgetCss } = sass.compile(badgeWidgetStylesPath, { style: "compressed", sourceMap: false });
  const logoSvg = await readFile(badgeWidgetLogoPath, "utf8");
  const digest = createHash("sha256").update(css).digest("hex").slice(0, 16);
  const stylesheetName = `site-${digest}.css`;
  const assetDirectory = join(outputDirectory, "assets");
  const publicSiteDirectory = join(outputDirectory, "desarrollo-seguro");
  await Promise.all([
    mkdir(assetDirectory, { recursive: true }),
    mkdir(publicSiteDirectory, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(assetDirectory, stylesheetName), css),
    writeFile(join(outputDirectory, "site.css"), css),
  ]);

  await Promise.all(htmlPages.map(async (page) => {
    const source = await readFile(join(repositoryRoot, "desarrollo-seguro", page), "utf8");
    let generated = source.replaceAll("/app/site.css", `/app/assets/${stylesheetName}`);
    if (generated === source) throw new Error("public_site_stylesheet_reference_missing");
    await writeFile(join(publicSiteDirectory, page), generated);
  }));
  const appIndexPath = join(outputDirectory, "index.html");
  let appIndex = null;
  try {
    appIndex = await readFile(appIndexPath, "utf8");
    await writeFile(appIndexPath, await addScriptIntegrity(appIndex, outputDirectory));
  } catch (error) {
    if (!isFileMissing(error)) throw error;
  }
  await Promise.all(publicScripts.map(async (script) => {
    let source = await readFile(join(repositoryRoot, "desarrollo-seguro", script), "utf8");
    if (script === "badge-widget.js") {
      source = source
        .replace('const BADGE_WIDGET_STYLES = "__DS_BADGE_WIDGET_STYLES__";', `const BADGE_WIDGET_STYLES = ${JSON.stringify(badgeWidgetCss)};`)
        .replace('const BADGE_WIDGET_LOGO_SVG = "__DS_BADGE_WIDGET_LOGO_SVG__";', `const BADGE_WIDGET_LOGO_SVG = ${JSON.stringify(logoSvg)};`);
      if (source.includes('const BADGE_WIDGET_STYLES = "__DS_BADGE_WIDGET_STYLES__";') ||
        source.includes('const BADGE_WIDGET_LOGO_SVG = "__DS_BADGE_WIDGET_LOGO_SVG__";')) {
        throw new Error("badge_widget_asset_injection_failed");
      }
    }
    if (script === "verificar.js") source = await bundleVerifierModule(source);
    await writeFile(join(publicSiteDirectory, script), source);
  }));
  await Promise.all(htmlPages.map(async (page) => {
    const target = join(publicSiteDirectory, page);
    await writeFile(target, await addScriptIntegrity(await readFile(target, "utf8"), outputDirectory));
  }));
  await Promise.all(publicAssets.map(async (asset) => {
    const source = await readFile(join(repositoryRoot, "desarrollo-seguro", asset));
    const target = join(publicSiteDirectory, asset);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, source);
  }));
  const scriptHashes = await collectScriptHashes([
    ...(appIndex === null ? [] : [await readFile(appIndexPath, "utf8")]),
    ...await Promise.all(htmlPages.map((page) => readFile(join(publicSiteDirectory, page), "utf8"))),
  ], outputDirectory);
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    `script-src ${[...scriptHashes].sort((left, right) => left.localeCompare(right, "en")).join(" ")} 'strict-dynamic'`,
    "connect-src 'self'",
  ].join("; ");
  await writeFile(join(outputDirectory, "nginx-security-headers.conf"),
    `add_header Content-Security-Policy \"${csp}\" always;\n`);
  return stylesheetName;
}

function isFileMissing(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function addScriptIntegrity(html, outputDirectory) {
  const tags = [...html.matchAll(/<script\b([^>]*?)\bsrc=(['"])([^'"]+)\2([^>]*)>/giu)];
  for (const match of tags.reverse()) {
    const [tag, before, quote, source, after] = match;
    const content = await readFile(resolveScriptPath(source, outputDirectory));
    const integrity = `sha256-${createHash("sha256").update(content).digest("base64")}`;
    const attributes = `${before}${after}`;
    const crossOrigin = /\bcrossorigin(?:\s|=|$)/iu.test(attributes) ? "" : ' crossorigin="anonymous"';
    html = `${html.slice(0, match.index)}<script${attributes} src=${quote}${source}${quote} integrity="${integrity}"${crossOrigin}>${html.slice(match.index + tag.length)}`;
  }
  return html;
}

async function bundleVerifierModule(source) {
  const importStatement = 'import { verifyReportBadge } from "./badge-api.mjs";';
  if (!source.includes(importStatement)) throw new Error("verification_module_import_missing");
  const badgeApi = (await readFile(join(repositoryRoot, "desarrollo-seguro/badge-api.mjs"), "utf8"))
    .replace(/^export (?=(?:const|async function) )/gmu, "");
  return source.replace(importStatement, `const verifyReportBadge = (() => {\n${badgeApi}\n  return verifyReportBadge;\n})();`);
}

async function collectScriptHashes(htmlDocuments, outputDirectory) {
  const hashes = new Set();
  for (const html of htmlDocuments) {
    const sources = [...html.matchAll(/<script\b[^>]*?\bsrc=(['"])([^'"]+)\1[^>]*>/giu)];
    for (const [, , source] of sources) {
      const content = await readFile(resolveScriptPath(source, outputDirectory));
      hashes.add(`'sha256-${createHash("sha256").update(content).digest("base64")}'`);
    }
  }
  if (hashes.size === 0) throw new Error("public_site_script_hashes_missing");
  return hashes;
}

function resolveScriptPath(source, outputDirectory) {
  const url = new URL(source, "https://desarrolloseguro.org");
  if (url.origin !== "https://desarrolloseguro.org" || url.search || url.hash) {
    throw new Error("public_site_script_source_invalid");
  }
  if (url.pathname.startsWith("/app/")) return join(outputDirectory, url.pathname.slice("/app/".length));
  if (url.pathname.startsWith("/desarrollo-seguro/")) {
    return join(outputDirectory, url.pathname.slice(1));
  }
  throw new Error("public_site_script_source_invalid");
}

function getOutputDirectory(argv) {
  const optionIndex = argv.indexOf("--output-dir");
  if (optionIndex === -1) return defaultOutputDirectory;
  const outputDirectory = argv[optionIndex + 1];
  if (!outputDirectory) throw new Error("public_site_output_directory_missing");
  return resolve(outputDirectory);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  buildPublicSiteAssets(getOutputDirectory(process.argv.slice(2)))
    .then((stylesheetName) => process.stdout.write(`Generated fingerprinted public stylesheet ${stylesheetName}.\n`))
    .catch(() => {
      process.stderr.write("public_site_asset_build_failed\n");
      process.exitCode = 1;
    });
}
