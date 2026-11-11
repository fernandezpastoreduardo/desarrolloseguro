import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const BLOCKING_SEVERITIES = new Set(["HIGH", "CRITICAL"]);

export function summarizeTrivyReports(reports) {
  const lines = [];
  let failed = false;

  for (const { fileName, report } of reports) {
    const findings = [];
    for (const result of report.Results ?? []) {
      for (const vulnerability of result.Vulnerabilities ?? []) {
        if (!BLOCKING_SEVERITIES.has(vulnerability.Severity)) continue;
        findings.push(vulnerability);
      }
    }

    const uniqueFindings = new Map();
    for (const finding of findings) {
      const key = [
        finding.VulnerabilityID,
        finding.PkgName,
        finding.InstalledVersion,
      ].join(":");
      uniqueFindings.set(key, finding);
    }

    const imageName = report.ArtifactName || fileName.replace(/\.json$/, "");
    if (uniqueFindings.size === 0) {
      lines.push(`${imageName}: no HIGH or CRITICAL vulnerabilities.`);
      continue;
    }

    failed = true;
    lines.push(`${imageName}: ${uniqueFindings.size} blocking finding(s):`);
    for (const finding of [...uniqueFindings.values()].sort((left, right) =>
      `${left.Severity}:${left.VulnerabilityID}:${left.PkgName}`.localeCompare(
        `${right.Severity}:${right.VulnerabilityID}:${right.PkgName}`,
      ),
    )) {
      const fix = finding.FixedVersion ? ` -> ${finding.FixedVersion}` : " (no fix available)";
      lines.push(
        `  ${finding.VulnerabilityID} ${finding.Severity} ${finding.PkgName} ${finding.InstalledVersion}${fix}`,
      );
    }
  }

  if (!failed) lines.push("No HIGH or CRITICAL vulnerabilities found.");
  return { failed, lines };
}

async function main(reportDirectory) {
  const fileNames = (await readdir(reportDirectory))
    .filter((fileName) => fileName.endsWith(".json"))
    .sort();
  if (fileNames.length === 0) {
    console.error(`No Trivy JSON reports found in ${reportDirectory}.`);
    process.exitCode = 2;
    return;
  }

  const reports = await Promise.all(
    fileNames.map(async (fileName) => ({
      fileName,
      report: JSON.parse(await readFile(join(reportDirectory, fileName), "utf8")),
    })),
  );
  const summary = summarizeTrivyReports(reports);
  for (const line of summary.lines) console.log(line);
  if (summary.failed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const reportDirectory = process.argv[2];
  if (!reportDirectory) {
    console.error("Usage: node scripts/trivy-report-summary.mjs <report-directory>");
    process.exitCode = 2;
  } else {
    try {
      await main(reportDirectory);
    } catch {
      console.error("Unable to read or summarize Trivy reports.");
      process.exitCode = 2;
    }
  }
}
