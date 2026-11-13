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
  "sello.html",
  "verificar.html",
  "informe-grumphya-prototipo.html",
];
const publicScripts = ["badge-api.mjs", "badge-widget.js", "verificar.js"];
const prototypeStylesPath = resolve(repositoryRoot, "desarrollo-seguro/informe-grumphya-prototipo.scss");

export async function buildPublicSiteAssets(outputDirectory = defaultOutputDirectory) {
  const { css } = sass.compile(sourcePath, { style: "compressed", sourceMap: false });
  const { css: prototypeCss } = sass.compile(prototypeStylesPath, { style: "compressed", sourceMap: false });
  const digest = createHash("sha256").update(css).digest("hex").slice(0, 16);
  const prototypeDigest = createHash("sha256").update(prototypeCss).digest("hex").slice(0, 16);
  const stylesheetName = `site-${digest}.css`;
  const prototypeStylesheetName = `prototype-report-${prototypeDigest}.css`;
  const assetDirectory = join(outputDirectory, "assets");
  const publicSiteDirectory = join(outputDirectory, "desarrollo-seguro");
  await Promise.all([
    mkdir(assetDirectory, { recursive: true }),
    mkdir(publicSiteDirectory, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(assetDirectory, stylesheetName), css),
    writeFile(join(assetDirectory, prototypeStylesheetName), prototypeCss),
    writeFile(join(outputDirectory, "site.css"), css),
  ]);

  await Promise.all(htmlPages.map(async (page) => {
    const source = await readFile(join(repositoryRoot, "desarrollo-seguro", page), "utf8");
    let generated = source.replaceAll("/app/site.css", `/app/assets/${stylesheetName}`);
    generated = generated.replaceAll("/app/prototype-report.css", `/app/assets/${prototypeStylesheetName}`);
    if (generated === source) throw new Error("public_site_stylesheet_reference_missing");
    await writeFile(join(publicSiteDirectory, page), generated);
  }));
  await Promise.all(publicScripts.map(async (script) => {
    const source = await readFile(join(repositoryRoot, "desarrollo-seguro", script));
    await writeFile(join(publicSiteDirectory, script), source);
  }));
  return stylesheetName;
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
