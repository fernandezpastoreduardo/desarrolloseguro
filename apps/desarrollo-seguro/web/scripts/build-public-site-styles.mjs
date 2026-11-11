import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sass from "sass";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../../../..");
const sourcePath = resolve(repositoryRoot, "desarrollo-seguro/styles.scss");
const outputPath = resolve(repositoryRoot, "apps/desarrollo-seguro/web/public/site.css");

await mkdir(dirname(outputPath), { recursive: true });
const { css } = sass.compile(sourcePath, { style: "compressed", sourceMap: false });
await writeFile(outputPath, css);
